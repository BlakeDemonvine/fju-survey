/* =====================================================================
 * questions.js — 問卷題目＋編碼規則（網站與 Apps Script 共用同一份）
 *
 * 這個檔案要放在兩個地方，內容必須一模一樣：
 *   ① 網站的 js/questions.js   —— 畫出表單、送出前先檢查一次
 *   ② Apps Script 的 questions.gs —— 再檢查一次、轉成代碼、寫進試算表
 *
 * 改題目的時候：兩邊都貼上新版本，並且把 version 改掉。
 * 前後端版本不一致時後端會直接拒收，不會把資料寫到錯的欄位。
 *
 * 編碼規則（寫進 Google 試算表的樣子）：
 *   單選題 → 一欄，依選項順序存 1、2、3…
 *   複選題 → 每個選項一欄，有勾 = 1、沒勾 = 0
 *   「其他」選項 → 多一欄「…_其他說明」存填答者自己寫的文字
 *   量表題（綜合問題）→ 每個項目一欄，依量表順序存 1～5
 *   問答題 → 一欄，存原文
 *   沒有出現的條件題（沒勾原住民 → 不會問哪一族）→ 複選欄位全部填 0
 *
 * 這裡只用 ES5 語法、不碰 DOM 也不碰 Apps Script 的 API，
 * 所以瀏覽器和 Apps Script 都能直接執行。
 * ===================================================================== */

var Survey = (function () {

  var SURVEY = {
    /* 改題目就改這個字串（隨便改成什麼都可以，只要兩邊一樣） */
    version: '2026-11-04b',

    questions: [
      {
        /* 單行文字題（line: true）。到服務台領小熊軟糖、扭蛋時用這個名字核對 */
        id: 'name', no: '一', code: 'Q1', short: '姓名',
        title: '您的姓名', type: 'text', line: true, required: true, maxLength: 20,
        desc: '填完問卷到服務台報上這個名字，就能領小熊軟糖、轉扭蛋喔！',
        placeholder: '例如：王小明',
        requiredMsg: '請填寫您的姓名',
        note: '填答者自己填的名字，服務台核對領獎用'
      },
      {
        id: 'gender', no: '二', code: 'Q2', short: '性別',
        title: '性別', type: 'single', required: true,
        options: ['男', '女', { label: '其他', other: true }]
      },
      {
        id: 'identity', no: '三', code: 'Q3', short: '身分',
        title: '身分', type: 'single', required: true,
        options: ['學生', '教職員', '校外人士']
      },
      {
        id: 'residence', no: '四', code: 'Q4', short: '居住地',
        title: '居住地', type: 'single', required: true,
        options: ['新莊', '樹林', '其他地區']
      },
      {
        id: 'age', no: '五', code: 'Q5', short: '年齡',
        title: '年齡', type: 'single', required: true,
        options: ['20歲以下', '21-30歲', '31-40歲', '41-50歲', '51-60歲', '60歲以上']
      },
      {
        id: 'ethnicity', no: '六', code: 'Q6', short: '族群',
        title: '請問您的族群背景為何？', hint: '可複選',
        type: 'multi', required: true,
        options: [
          '本省閩南人', '客家人', '外省人', '原住民',
          { label: '不願透露', exclusive: true },     // 勾了這個，其他選項會自動取消
          { label: '其他', other: true }
        ]
      },
      {
        /* 條件題：上一題有勾「原住民」才會出現，取消勾選就消失 */
        id: 'tribe', no: '六之一', code: 'Q6a', short: '族別',
        title: '請問您是哪一族？', hint: '可複選',
        type: 'multi', required: true,
        showIf: { q: 'ethnicity', option: '原住民' },
        options: [
          '阿美族', '泰雅族', '排灣族', '布農族', '卑南族', '魯凱族',
          '鄒族', '賽夏族', '雅美族（達悟族）', '邵族', '噶瑪蘭族', '太魯閣族',
          '撒奇萊雅族', '賽德克族', '拉阿魯哇族', '卡那卡那富族', '西拉雅族',
          { label: '其他', other: true, placeholder: '例如：其他平埔族群' }
        ]
      },
      {
        id: 'activities', no: '七', code: 'Q7', short: '參與活動',
        title: '您今日參與的攤位／活動？', hint: '可複選',
        type: 'multi', required: true,
        options: ['主舞台表演活動', '攤位／市集', '野餐', '親子攝影活動', { label: '其他', other: true }]
      },
      {
        id: 'spend', no: '八', code: 'Q8', short: '花費',
        title: '您願意在本次原遊會花費多少金額？', type: 'single', required: true,
        options: ['500元以下', '500-750元', '750-1000元', '1000-1500元', '1500-2000元', '2000元以上']
      },
      {
        id: 'satisfaction', no: '九', code: 'Q9', short: '綜合',
        title: '綜合問題', hint: '每一項都要選',
        type: 'matrix', required: true,
        scale: ['非常滿意', '滿意', '普通', '不滿意', '非常不滿意'],
        rows: [
          { label: '活動場地安排', short: '場地安排' },
          { label: '工作人員的服務態度', short: '服務態度' },
          { label: '本次活動可提升我對原住民族相關領域的知識', short: '原民知識' },
          { label: '本次活動整體規劃', short: '整體規劃' }
        ]
      },
      {
        id: 'suggestion', no: '十', code: 'Q10', short: '建議',
        title: '您對本次原遊會有什麼建議？', type: 'text', required: false,
        maxLength: 1000, placeholder: '想說什麼都可以，沒有也沒關係'
      }
    ]
  };

  var OTHER_MAX = 100;   // 「其他」說明最多幾個字

  /* ---------- 小工具 ---------- */

  function opt(o) {
    return typeof o === 'string' ? { label: o } : o;
  }

  function options(q) {
    return (q.options || []).map(opt);
  }

  function byId(id) {
    for (var i = 0; i < SURVEY.questions.length; i++) {
      if (SURVEY.questions[i].id === id) return SURVEY.questions[i];
    }
    return null;
  }

  /** 這題的「其他」選項是第幾個（1 起算），沒有就回傳 0 */
  function otherIndex(q) {
    var list = options(q);
    for (var i = 0; i < list.length; i++) if (list[i].other) return i + 1;
    return 0;
  }

  function optionIndex(q, label) {
    var list = options(q);
    for (var i = 0; i < list.length; i++) if (list[i].label === label) return i + 1;
    return 0;
  }

  function isInt(v) {
    return typeof v === 'number' && isFinite(v) && Math.floor(v) === v;
  }

  function str(v) {
    return typeof v === 'string' ? v.replace(/^\s+|\s+$/g, '') : '';
  }

  /** 複選答案整理成「排好序、不重複、都在範圍內」的陣列；格式不對回傳 null */
  function cleanMulti(q, v) {
    if (v === undefined || v === null) return [];
    if (Object.prototype.toString.call(v) !== '[object Array]') return null;
    var n = options(q).length, seen = {}, out = [];
    for (var i = 0; i < v.length; i++) {
      if (!isInt(v[i]) || v[i] < 1 || v[i] > n) return null;
      if (!seen[v[i]]) { seen[v[i]] = 1; out.push(v[i]); }
    }
    return out.sort(function (a, b) { return a - b; });
  }

  /* ---------- 條件題 ---------- */

  /** 這一題現在要不要出現（依其他題的答案決定） */
  function visible(q, answers) {
    if (!q.showIf) return true;
    var dep = byId(q.showIf.q);
    if (!dep || !visible(dep, answers)) return false;
    var want = optionIndex(dep, q.showIf.option);
    var v = answers ? answers[dep.id] : null;
    if (dep.type === 'multi') {
      var list = cleanMulti(dep, v) || [];
      return list.indexOf(want) > -1;
    }
    return v === want;
  }

  /* ---------- 檢查 ---------- */

  /**
   * 回傳 { 題目id: 錯誤訊息 }，全部沒問題就是空物件。
   * 前端拿來標紅字，後端拿來擋掉不完整或被竄改的資料。
   */
  function validate(answers) {
    answers = answers || {};
    var errors = {};

    SURVEY.questions.forEach(function (q) {
      if (!visible(q, answers)) return;
      var v = answers[q.id];
      var oi = otherIndex(q);
      var otherText = str(answers[q.id + '_other']);

      if (q.type === 'single') {
        if (v === undefined || v === null || v === '') {
          if (q.required) errors[q.id] = '請選擇一個選項';
          return;
        }
        if (!isInt(v) || v < 1 || v > options(q).length) { errors[q.id] = '資料格式不正確'; return; }
        if (oi && v === oi && !otherText) errors[q.id] = '請填寫「其他」的內容';
        else if (otherText.length > OTHER_MAX) errors[q.id] = '「其他」最多 ' + OTHER_MAX + ' 個字';
        return;
      }

      if (q.type === 'multi') {
        var list = cleanMulti(q, v);
        if (list === null) { errors[q.id] = '資料格式不正確'; return; }
        if (!list.length) { if (q.required) errors[q.id] = '請至少選擇一項'; return; }
        var opts = options(q);
        for (var i = 0; i < list.length; i++) {
          if (opts[list[i] - 1].exclusive && list.length > 1) {
            errors[q.id] = '「' + opts[list[i] - 1].label + '」不能和其他選項一起選';
            return;
          }
        }
        if (oi && list.indexOf(oi) > -1 && !otherText) errors[q.id] = '請填寫「其他」的內容';
        else if (otherText.length > OTHER_MAX) errors[q.id] = '「其他」最多 ' + OTHER_MAX + ' 個字';
        return;
      }

      if (q.type === 'matrix') {
        var arr = Object.prototype.toString.call(v) === '[object Array]' ? v : [];
        var missing = 0;
        for (var r = 0; r < q.rows.length; r++) {
          var x = arr[r];
          if (x === undefined || x === null || x === '') { missing++; continue; }
          if (!isInt(x) || x < 1 || x > q.scale.length) { errors[q.id] = '資料格式不正確'; return; }
        }
        if (missing && q.required) {
          errors[q.id] = missing === q.rows.length ? '請每一項都選一個' : '還有 ' + missing + ' 項沒有選';
        }
        return;
      }

      if (q.type === 'text') {
        if (v !== undefined && v !== null && typeof v !== 'string') { errors[q.id] = '資料格式不正確'; return; }
        var t = str(v);
        if (!t && q.required) errors[q.id] = q.requiredMsg || '請填寫這一題';
        else if (q.maxLength && t.length > q.maxLength) errors[q.id] = '最多 ' + q.maxLength + ' 個字';
      }
    });

    return errors;
  }

  /* ---------- 欄位與編碼 ---------- */

  /**
   * 試算表的欄位（不含最前面的「時間戳記」「裝置ID」），順序就是寫入的順序。
   * 每一欄長這樣：{ header, q, kind, index, meaning }
   */
  function columns() {
    var cols = [];
    SURVEY.questions.forEach(function (q) {
      var base = q.code + '_' + q.short;

      if (q.type === 'single') {
        cols.push({ header: base, q: q, kind: 'single' });
        if (otherIndex(q)) cols.push({ header: base + '_其他說明', q: q, kind: 'otherText' });
      } else if (q.type === 'multi') {
        options(q).forEach(function (o, i) {
          cols.push({ header: base + '_' + (o.col || o.label), q: q, kind: 'flag', index: i + 1, option: o });
        });
        if (otherIndex(q)) cols.push({ header: base + '_其他說明', q: q, kind: 'otherText' });
      } else if (q.type === 'matrix') {
        q.rows.forEach(function (row, i) {
          cols.push({ header: q.code + '-' + (i + 1) + '_' + row.short, q: q, kind: 'scale', index: i, row: row });
        });
      } else if (q.type === 'text') {
        cols.push({ header: base, q: q, kind: 'text' });
      }
    });
    return cols;
  }

  function headers() {
    return columns().map(function (c) { return c.header; });
  }

  /**
   * 把填答內容轉成一列數值，順序跟 headers() 一樣。
   * 呼叫前請先 validate()，這裡假設資料是對的。
   */
  function encode(answers) {
    answers = answers || {};
    return columns().map(function (c) {
      var q = c.q;
      var shown = visible(q, answers);
      var v = answers[q.id];

      if (c.kind === 'flag') {
        if (!shown) return 0;                       // 沒問到的複選題 → 全部 0
        return (cleanMulti(q, v) || []).indexOf(c.index) > -1 ? 1 : 0;
      }
      if (!shown) return '';

      if (c.kind === 'single') return isInt(v) ? v : '';
      if (c.kind === 'otherText') {
        var oi = otherIndex(q);
        var picked = q.type === 'multi' ? (cleanMulti(q, v) || []).indexOf(oi) > -1 : v === oi;
        return picked ? str(answers[q.id + '_other']) : '';
      }
      if (c.kind === 'scale') {
        var x = (v || [])[c.index];
        return isInt(x) ? x : '';
      }
      if (c.kind === 'text') return q.line ? str(v).replace(/\s+/g, ' ') : str(v);   // 單行題把換行、連續空白收成一格
      return '';
    });
  }

  /**
   * 代碼對照表：每一欄的意思。Apps Script 會把它寫成另一個工作表，
   * 之後看資料或跑統計時對照用。
   */
  function codebook() {
    var cols = columns();
    var rows = [['欄位', '題號', '題目', '類型', '代碼說明']];
    rows.push(['時間戳記', '', '送出的時間', '系統', '']);
    rows.push(['裝置ID', '', '用來確認一台手機只填一次', '系統', '']);

    cols.forEach(function (c) {
      var q = c.q;
      var cond = q.showIf ? '（只有第' + byId(q.showIf.q).no + '題勾選「' + q.showIf.option + '」才會出現）' : '';

      if (c.kind === 'single') {
        rows.push([c.header, q.no, q.title + cond, '單選',
          options(q).map(function (o, i) { return (i + 1) + ' = ' + o.label; }).join('\n')]);
      } else if (c.kind === 'flag') {
        rows.push([c.header, q.no, q.title + cond, '複選',
          '1 = 有勾「' + c.option.label + '」，0 = 沒勾' +
          (q.showIf ? '\n沒有出現這題的人一律是 0' : '')]);
      } else if (c.kind === 'otherText') {
        rows.push([c.header, q.no, q.title + cond, '文字', '選「其他」時填寫的內容，沒選就是空白']);
      } else if (c.kind === 'scale') {
        rows.push([c.header, q.no, q.title + '：' + c.row.label, '量表',
          q.scale.map(function (s, i) { return (i + 1) + ' = ' + s; }).join('\n')]);
      } else if (c.kind === 'text') {
        rows.push([c.header, q.no, q.title, '問答', q.note || (q.required ? '必填' : '選填，沒寫就是空白')]);
      }
    });
    return rows;
  }

  return {
    data: SURVEY,
    version: SURVEY.version,
    questions: SURVEY.questions,
    options: options,
    otherIndex: otherIndex,
    optionIndex: optionIndex,
    byId: byId,
    visible: visible,
    validate: validate,
    columns: columns,
    headers: headers,
    encode: encode,
    codebook: codebook,
    OTHER_MAX: OTHER_MAX
  };
})();

/* 讓 Node 也能載入（只有跑測試的時候用得到，瀏覽器和 Apps Script 會略過） */
if (typeof module !== 'undefined' && module.exports) module.exports = Survey;
