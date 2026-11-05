/* =====================================================================
 * Code.gs — 活動回饋問卷的後端（Google Apps Script）
 *
 * 這個 Apps Script 專案裡要有兩個檔案：
 *   Code.gs       ← 這個檔案
 *   questions.gs  ← 跟網站的 js/questions.js 內容一模一樣
 *
 * 收到一份問卷會做這幾件事：
 *   1. 檢查問卷版本跟網站一致（題目改過但只改一邊 → 拒收，不會寫錯欄）
 *   2. 再檢查一次每題有沒有填、選項在不在範圍內（不相信前端）
 *   3. 同一個裝置 ID 已經送過 → 拒收（一台手機只能填一次）
 *   4. 依 questions.gs 的規則轉成代碼，寫一列到「回覆」工作表
 *
 * 另外還有一個 resetDevice：測試模式下刪掉「這支手機」送過的紀錄（見下方說明）。
 *
 * ⚠️ 改了這個檔案之後要重新部署才會生效：
 *    部署 → 管理部署作業 → ✎ 編輯 → 版本選「新版本」→ 部署（網址不會變）
 * ===================================================================== */

/** 留空 = 用這個 Apps Script 所附屬的那份試算表（從試算表「擴充功能 → Apps Script」建立的就留空） */
var SHEET_ID = '';

var DATA_SHEET = '回覆';
var CODEBOOK_SHEET = '代碼對照表';
var FIXED_HEADERS = ['時間戳記', '裝置ID'];
var MAX_BODY = 30000;   // 一份問卷頂多幾 KB，太大的直接擋掉

/* ================= 入口 ================= */

function doPost(e) {
  var raw = (e && e.postData && e.postData.contents) || '';
  if (raw.length > MAX_BODY) return json_({ ok: false, code: 'BAD_REQUEST', error: '資料太大' });

  var body;
  try { body = JSON.parse(raw || '{}'); }
  catch (err) { return json_({ ok: false, code: 'BAD_REQUEST', error: '資料格式錯誤' }); }

  try {
    if (body.action === 'submit') return json_(submit_(body));
    if (body.action === 'resetDevice') return json_(resetDevice_(body));
    if (body.action === 'ping') return json_({ ok: true, version: Survey.version });
    return json_({ ok: false, code: 'BAD_REQUEST', error: '未知的動作' });
  } catch (err) {
    console.error(err && err.stack || err);
    return json_({ ok: false, code: 'SERVER', error: '伺服器發生錯誤，請稍後再按一次送出' });
  }
}

/** 部署完直接用瀏覽器打開網址，看到這個就代表後端活著 */
function doGet() {
  return json_({
    ok: true,
    message: '問卷後端運作中',
    version: Survey.version,
    columns: FIXED_HEADERS.length + Survey.headers().length
  });
}

/* ================= 收問卷 ================= */

function submit_(body) {
  if (body.version !== Survey.version) {
    return { ok: false, code: 'VERSION', error: '問卷版本不一致，請重新整理頁面後再送出' };
  }

  var deviceId = String(body.deviceId || '');
  if (!/^[\w-]{8,64}$/.test(deviceId)) {
    return { ok: false, code: 'BAD_REQUEST', error: '缺少裝置識別碼，請重新整理頁面' };
  }

  var answers = body.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    return { ok: false, code: 'INVALID', error: '沒有收到作答內容' };
  }

  var errors = Survey.validate(answers);
  if (Object.keys(errors).length) {
    return { ok: false, code: 'INVALID', error: '有題目沒有填完或格式不對', fields: errors };
  }

  var row = [new Date(), safeCell_(deviceId)].concat(Survey.encode(answers).map(safeCell_));

  /* 同一時間很多人送出時要排隊：「檢查有沒有填過」跟「寫入」中間不能被插隊，
     不然同一台手機連按兩下就會在兩個執行緒都通過檢查，變成兩筆。 */
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    return { ok: false, code: 'BUSY', error: '現在送出的人很多，請再按一次送出' };
  }
  try {
    var sheet = ensureSheets_();
    if (deviceExists_(sheet, deviceId)) {
      return { ok: false, code: 'DUPLICATE', error: '這支手機已經填過問卷了' };
    }
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  return { ok: true };
}

/* ================= 測試模式：刪掉這支手機的紀錄 =================
 * 網站開了 TEST_MODE 之後，填完的畫面會有「刪除這支手機的紀錄，再填一次」，
 * 按下去就呼叫這裡：把「回覆」（還有「回覆_舊版_…」）裡這個裝置 ID 的列全部刪掉。
 *
 * 不用另外設密碼也是安全的：只能刪「自己這支手機」的紀錄。
 * 裝置 ID 是每支手機自己隨機產生的長亂碼，不會顯示在網頁上，猜不到別人的，
 * 所以就算有人自己送這個請求，最多也只是把他自己那筆刪掉重填，不會變成多一筆。
 */
function resetDevice_(body) {
  var deviceId = String(body.deviceId || '');
  if (!/^[\w-]{8,64}$/.test(deviceId)) {
    return { ok: false, code: 'BAD_REQUEST', error: '缺少裝置識別碼，請重新整理頁面' };
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    return { ok: false, code: 'BUSY', error: '現在送出的人很多，請再按一次' };
  }
  try {
    var deleted = 0;
    spreadsheet_().getSheets().forEach(function (sheet) {
      var name = sheet.getName();
      if (name !== DATA_SHEET && name.indexOf(DATA_SHEET + '_舊版_') !== 0) return;
      var last = sheet.getLastRow();
      if (last < 2) return;
      var rows = sheet.getRange(2, 2, last - 1, 1)
        .createTextFinder(deviceId).matchEntireCell(true).matchCase(true)
        .findAll()
        .map(function (cell) { return cell.getRow(); })
        .sort(function (a, b) { return b - a; });      // 從下面往上刪，上面的列號才不會跑掉
      rows.forEach(function (r) { sheet.deleteRow(r); });
      deleted += rows.length;
    });
    SpreadsheetApp.flush();
    return { ok: true, deleted: deleted };
  } finally {
    lock.releaseLock();
  }
}

/** 這個裝置 ID 是不是已經在 B 欄出現過 */
function deviceExists_(sheet, deviceId) {
  var last = sheet.getLastRow();
  if (last < 2) return false;
  return !!sheet.getRange(2, 2, last - 1, 1)
    .createTextFinder(deviceId).matchEntireCell(true).matchCase(true)
    .findNext();
}

/**
 * 使用者自己打的文字（「其他」說明、建議）前面加一個 '，
 * 讓試算表把它當純文字：
 *   - 開頭是 = + - @ 的內容不會被當成公式執行
 *   - 「3-5」「11/21」不會被自動改成日期，「007」不會變成 7
 * 這個 ' 在試算表裡看不到，也不會被匯出。
 */
function safeCell_(v) {
  if (typeof v === 'string' && v !== '') return "'" + v;
  return v;
}

/* ================= 工作表 ================= */

function spreadsheet_() {
  return SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

/**
 * 確定「回覆」工作表存在、而且標題列跟現在的題目一致。
 * 題目改過（標題列對不上）的話，舊的那張改名保留，另外開一張新的，
 * 舊資料一筆都不會被動到。
 */
function ensureSheets_() {
  var ss = spreadsheet_();
  var want = FIXED_HEADERS.concat(Survey.headers());
  var sheet = ss.getSheetByName(DATA_SHEET);

  if (!sheet) {
    sheet = ss.insertSheet(DATA_SHEET, 0);
    writeHeaders_(sheet, want);
    writeCodebook_(ss);
    return sheet;
  }

  var lastCol = sheet.getLastColumn();
  var have = lastCol ? sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0] : [];
  while (have.length && have[have.length - 1] === '') have.pop();

  if (have.join('\u0001') === want.join('\u0001')) return sheet;

  if (sheet.getLastRow() <= 1) {
    // 還沒有任何資料：直接重寫標題列
    sheet.clear();
    writeHeaders_(sheet, want);
  } else {
    var stamp = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyyMMdd-HHmm');
    sheet.setName(DATA_SHEET + '_舊版_' + stamp);
    sheet = ss.insertSheet(DATA_SHEET, 0);
    writeHeaders_(sheet, want);
  }
  writeCodebook_(ss);
  return sheet;
}

function writeHeaders_(sheet, headers) {
  sheet.getRange(1, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#FBE7DC')
    .setVerticalAlignment('middle')
    .setWrap(true);
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(1);
  sheet.getRange(2, 1, Math.max(1, sheet.getMaxRows() - 1), 1).setNumberFormat('yyyy/mm/dd hh:mm:ss');
  sheet.setColumnWidth(1, 150);
  sheet.setColumnWidth(2, 110);
  sheet.setRowHeight(1, 54);
}

/** 代碼對照表：每一欄的 1、2、3 代表什麼 */
function writeCodebook_(ss) {
  var sh = ss.getSheetByName(CODEBOOK_SHEET) || ss.insertSheet(CODEBOOK_SHEET);
  sh.clear();
  var rows = Survey.codebook();
  var range = sh.getRange(1, 1, rows.length, rows[0].length);
  range.setNumberFormat('@').setValues(rows).setVerticalAlignment('top').setWrap(true);
  sh.getRange(1, 1, 1, rows[0].length).setFontWeight('bold').setBackground('#FBE7DC');
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 220);
  sh.setColumnWidth(2, 60);
  sh.setColumnWidth(3, 320);
  sh.setColumnWidth(4, 60);
  sh.setColumnWidth(5, 280);
}

/* ================= 手動執行用 ================= */

/**
 * 第一次部署前，在編輯器上方選「setup」按 ▶ 執行一次：
 *   - 會跳出授權畫面（允許存取試算表）
 *   - 建好「回覆」和「代碼對照表」兩張工作表
 */
function setup() {
  var ss = spreadsheet_();
  ensureSheets_();
  writeCodebook_(ss);
  Logger.log('完成！「' + DATA_SHEET + '」共 ' + (FIXED_HEADERS.length + Survey.headers().length) +
             ' 欄，問卷版本 ' + Survey.version);
}

/* ================= 工具 ================= */

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
