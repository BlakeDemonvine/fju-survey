/* =====================================================================
 * form.js — 畫出問卷、處理作答、一機一次、送出到 Apps Script
 * ===================================================================== */

(function () {

  var cfg = window.APP_CONFIG || {};
  var KEY = 'fjus26_';                // 本機儲存的前綴，跟報名系統的 fju_ 分開
  var app = document.getElementById('app');

  var state = {
    answers: {},        // 目前的作答（格式見 questions.js 的 validate）
    attempted: false,   // 按過送出之後，沒填的題目才開始標紅字
    busy: false
  };

  /* ================= 小工具 ================= */

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function keys(o) { return Object.keys(o || {}); }

  function toast(msg, kind, ms) {
    var host = document.getElementById('toastHost');
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .25s';
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 260);
    }, ms || (kind === 'err' ? 4200 : 2600));
  }

  var isTouch = (function () {
    try { return window.matchMedia('(hover: none)').matches; } catch (e) { return 'ontouchstart' in window; }
  })();

  /* ================= 一台手機只能填一次 =================
   * 第一次打開就產生一組隨機的裝置 ID，同時存在 localStorage 和 cookie，
   * 其中一邊被清掉還能從另一邊找回來。送出成功後兩邊都記一個「已填」。
   * 後端也會檢查同一個裝置 ID 有沒有送過，所以連點兩下、網路斷掉重送
   * 都不會變成兩筆。
   */

  function lsGet(k) { try { return localStorage.getItem(KEY + k); } catch (e) { return null; } }
  function lsSet(k, v) {
    try {
      if (v === null) localStorage.removeItem(KEY + k);
      else localStorage.setItem(KEY + k, v);
    } catch (e) { /* 無痕模式或空間不足：交給 cookie */ }
  }
  function ckGet(k) {
    var m = document.cookie.match(new RegExp('(?:^|;\\s*)' + KEY + k + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function ckSet(k, v) {
    // cookie 只綁在這個資料夾，跟同一個 github.io 底下的其他專案互不干擾
    var path = location.pathname.replace(/[^\/]*$/, '') || '/';
    document.cookie = KEY + k + '=' + (v === null ? '' : encodeURIComponent(v)) +
      '; path=' + path + '; max-age=' + (v === null ? 0 : 31536000) + '; SameSite=Lax' +
      (location.protocol === 'https:' ? '; Secure' : '');
  }

  function newId() {
    try {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
      if (window.crypto && crypto.getRandomValues) {
        var b = new Uint8Array(16);
        crypto.getRandomValues(b);
        return Array.prototype.map.call(b, function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');
      }
    } catch (e) { /* 舊瀏覽器 */ }
    return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }

  var Device = {
    id: function () {
      var id = lsGet('device') || ckGet('device');
      if (!id || !/^[\w-]{8,64}$/.test(id)) id = newId();
      lsSet('device', id);
      ckSet('device', id);
      return id;
    },
    done: function () { return !!(lsGet('done') || ckGet('done')); },
    /** 送出成功：記下「已填」，也記下填的名字（之後再打開還能提醒他去服務台報哪個名字） */
    markDone: function (name) {
      var t = String(Date.now());
      lsSet('done', t);
      ckSet('done', t);
      if (name) { lsSet('name', name); ckSet('name', name); }
    },
    name: function () { return lsGet('name') || ckGet('name') || ''; },
    reset: function () {
      ['device', 'done', 'draft', 'name'].forEach(function (k) { lsSet(k, null); ckSet(k, null); });
    }
  };

  /* ================= 草稿：填到一半重新整理不會不見 ================= */

  var saveTimer = null;
  function saveDraft() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      lsSet('draft', JSON.stringify(state.answers));
    }, 250);
  }
  function loadDraft() {
    try {
      var o = JSON.parse(lsGet('draft') || 'null');
      return o && typeof o === 'object' ? o : null;
    } catch (e) { return null; }
  }
  function clearDraft() { clearTimeout(saveTimer); lsSet('draft', null); }

  /* ================= 畫出問卷 ================= */

  /** 「非常不滿意」在手機上拆成兩行：「非常」/「不滿意」，按鈕才不會擠爆 */
  function splitScale(s) {
    return s.indexOf('非常') === 0 && s.length > 2 ? ['非常', s.slice(2)] : [s, ''];
  }

  function optsHTML(q) {
    var type = q.type === 'single' ? 'radio' : 'checkbox';
    var list = Survey.options(q);
    return '<div class="opts' + (list.length >= 10 ? ' cols-2' : '') + '">' +
      list.map(function (o, i) {
        var html =
          '<label class="opt' + (type === 'checkbox' ? ' is-check' : '') + '" data-opt="' + (i + 1) + '">' +
            '<input type="' + type + '" name="' + q.id + '" value="' + (i + 1) + '">' +
            '<span class="opt-mark" aria-hidden="true"></span>' +
            '<span class="opt-label">' + esc(o.label) + '</span>' +
          '</label>';
        if (o.other) {
          html += '<div class="other-box" data-other-box="' + q.id + '" hidden>' +
            '<input type="text" data-other="' + q.id + '" maxlength="' + Survey.OTHER_MAX + '" ' +
            'enterkeyhint="done" placeholder="' + esc(o.placeholder || '請說明') + '" ' +
            'aria-label="' + esc(q.title) + '：其他，請說明"></div>';
        }
        return html;
      }).join('') +
    '</div>';
  }

  function matrixHTML(q) {
    return '<div class="mx">' + q.rows.map(function (row, r) {
      return '<div class="mx-row" data-row="' + r + '">' +
        '<div class="mx-label" id="mx-' + q.id + '-' + r + '"><span class="mx-n">' + (r + 1) + '</span><span>' + esc(row.label) + '</span></div>' +
        '<div class="mx-scale" role="radiogroup" aria-labelledby="mx-' + q.id + '-' + r + '">' +
          q.scale.map(function (s, k) {
            var p = splitScale(s);
            return '<label class="mx-opt">' +
              '<input type="radio" name="' + q.id + '__' + r + '" value="' + (k + 1) + '" data-mx="' + q.id + '" data-row="' + r + '">' +
              '<span class="mx-t"><span class="mx-a">' + esc(p[0]) + '</span>' +
                (p[1] ? '<span class="mx-b">' + esc(p[1]) + '</span>' : '') + '</span>' +
            '</label>';
          }).join('') +
        '</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  function textHTML(q) {
    if (q.line) {
      // 單行（姓名）：不用字數計數，手機鍵盤的 Enter 鍵顯示「下一步」
      return '<input type="text" data-text="' + q.id + '" maxlength="' + (q.maxLength || 50) + '" ' +
        'autocomplete="' + (q.id === 'name' ? 'name' : 'off') + '" enterkeyhint="next" ' +
        'placeholder="' + esc(q.placeholder || '') + '" aria-labelledby="qt-' + q.id + '">';
    }
    return '<textarea data-text="' + q.id + '" rows="4" maxlength="' + (q.maxLength || 1000) + '" ' +
      'placeholder="' + esc(q.placeholder || '') + '" aria-labelledby="qt-' + q.id + '"></textarea>' +
      '<div class="ta-count"><span data-count="' + q.id + '">0</span> / ' + (q.maxLength || 1000) + '</div>';
  }

  function questionHTML(q) {
    var body = q.type === 'matrix' ? matrixHTML(q)
             : q.type === 'text'   ? textHTML(q)
             : optsHTML(q);
    return '<section class="q-card' + (q.showIf ? ' is-sub' : '') + '" id="q-' + q.id + '" data-q="' + q.id + '"' +
        (q.showIf ? ' hidden' : '') + ' role="group" aria-labelledby="qt-' + q.id + '">' +
      '<div class="q-head">' +
        '<span class="q-no">' + esc(q.no) + '</span>' +
        '<div class="q-titles">' +
          '<h2 class="q-title" id="qt-' + q.id + '">' + esc(q.title) +
            (q.required ? ' <span class="req" aria-label="必填">*</span>' : '') + '</h2>' +
          (q.hint ? '<span class="tag tag-amber q-hint">' + esc(q.hint) + '</span>' : '') +
          (!q.required ? '<span class="tag tag-muted q-hint">選填</span>' : '') +
          (q.desc ? '<p class="q-desc">' + esc(q.desc) + '</p>' : '') +
        '</div>' +
      '</div>' +
      body +
      '<p class="q-err" id="qe-' + q.id + '" hidden></p>' +
    '</section>';
  }

  function renderForm() {
    var total = Survey.questions.filter(function (q) { return !q.showIf; }).length;
    var configured = cfg.GAS_URL && cfg.GAS_URL.indexOf('請貼上') === -1;

    app.innerHTML =
      '<section class="card intro">' +
        '<span class="eyebrow">活動回饋問卷</span>' +
        '<h1>親愛的參與者您好：</h1>' +
        '<p>感謝您撥冗參加本次園遊會活動。為了解活動的整體實施情形，並作為未來活動規劃與品質提升之參考，懇請您協助填寫以下問卷。</p>' +
        '<p style="margin:0">再次感謝您的寶貴時間與支持！</p>' +
        '<p class="sign">輔仁大學民生學院<br>輔仁大學原住民家庭關懷培力棧　敬上</p>' +
        '<div class="intro-meta">' +
          '<span class="tag tag-brand">共 ' + total + ' 題</span>' +
          '<span class="tag tag-muted">⏱ 約 2 分鐘</span>' +
          '<span class="req-note"><span class="req">*</span> 表示必填</span>' +
        '</div>' +
      '</section>' +

      '<form id="survey" novalidate autocomplete="off">' +
        Survey.questions.map(questionHTML).join('') +

        '<section class="card submit-card">' +
          (configured ? '' : '<div class="notice notice-warn">⚠️ 還沒設定後端網址（js/config.js 的 GAS_URL），現在只能預覽、不能送出。</div>') +
          '<p class="missing" id="missingNote" hidden></p>' +
          '<div class="submit-row">' +
            '<button type="submit" class="btn btn-xl" id="submitBtn">送出問卷</button>' +
            '<button type="button" class="link-btn" id="clearBtn">清除重填</button>' +
          '</div>' +
          '<p class="note">送出之後就不能修改，每支手機只能填寫一次喔。</p>' +
        '</section>' +
      '</form>';

    bindForm($('#survey'));
  }

  /* ================= 作答 → state ================= */

  function cardOf(qid) { return document.getElementById('q-' + qid); }

  function checkedValues(qid) {
    return $$('#q-' + qid + ' input[name="' + qid + '"]:checked').map(function (el) { return +el.value; });
  }

  /** 複選題的「不願透露」這種選項：勾它就清掉別的，勾別的就清掉它 */
  function enforceExclusive(q, changed) {
    if (!changed.checked) return;
    var opts = Survey.options(q);
    var changedOpt = opts[+changed.value - 1];
    $$('#q-' + q.id + ' input[name="' + q.id + '"]').forEach(function (el) {
      if (el === changed || !el.checked) return;
      var o = opts[+el.value - 1];
      if (changedOpt.exclusive || o.exclusive) el.checked = false;
    });
  }

  /** 選項外觀跟著勾選狀態走（不靠 :has()，舊手機也能正常顯示） */
  function syncOptions(q) {
    var card = cardOf(q.id);
    if (!card) return;
    $$('.opt', card).forEach(function (lab) {
      lab.classList.toggle('is-on', lab.querySelector('input').checked);
    });
    $$('.mx-opt', card).forEach(function (lab) {
      lab.classList.toggle('is-on', lab.querySelector('input').checked);
    });
    $$('.mx-row', card).forEach(function (row, r) {
      var v = state.answers[q.id];
      row.classList.toggle('is-set', !!(v && v[r]));
    });
  }

  /** 選了「其他」才出現輸入框；回傳這次是不是剛打開 */
  function syncOther(q) {
    var oi = Survey.otherIndex(q);
    if (!oi) return false;
    var box = $('[data-other-box="' + q.id + '"]');
    if (!box) return false;
    var v = state.answers[q.id];
    var on = q.type === 'multi' ? (v || []).indexOf(oi) > -1 : v === oi;
    var opened = on && box.hidden;
    box.hidden = !on;
    return opened;
  }

  /** 條件題：該出現就出現，不該出現就收起來並清掉答案 */
  function syncVisibility() {
    Survey.questions.forEach(function (q) {
      if (!q.showIf) return;
      var card = cardOf(q.id);
      var show = Survey.visible(q, state.answers);
      if (show && card.hidden) {
        card.hidden = false;
        card.classList.remove('is-entering');
        void card.offsetWidth;
        card.classList.add('is-entering');
      } else if (!show && !card.hidden) {
        card.hidden = true;
        delete state.answers[q.id];
        delete state.answers[q.id + '_other'];
        $$('input', card).forEach(function (el) {
          if (el.type === 'text') el.value = '';
          else el.checked = false;
        });
        syncOptions(q);
        syncOther(q);
      }
    });
  }

  function onChoice(el) {
    var q = Survey.byId(el.name);
    if (!q) return;
    if (q.type === 'single') {
      state.answers[q.id] = +el.value;
    } else {
      enforceExclusive(q, el);
      state.answers[q.id] = checkedValues(q.id);
    }
    syncOptions(q);
    var opened = syncOther(q);
    syncVisibility();
    refresh();

    // 剛選了「其他」→ 直接把游標放進說明欄。
    // 要在這個事件裡同步呼叫，iOS 才會把鍵盤叫出來（延遲呼叫會被當成不是使用者操作）
    if (opened) {
      var input = $('[data-other="' + q.id + '"]');
      if (input) { try { input.focus(); } catch (e) { /* 忽略 */ } }
    }
  }

  function onMatrix(el) {
    var q = Survey.byId(el.dataset.mx);
    var arr = (state.answers[q.id] || []).slice();
    while (arr.length < q.rows.length) arr.push(null);
    arr[+el.dataset.row] = +el.value;
    state.answers[q.id] = arr;
    syncOptions(q);
    refresh();
  }

  function bindForm(form) {
    form.addEventListener('change', function (ev) {
      var el = ev.target;
      if (el.dataset.mx) return onMatrix(el);
      if (el.type === 'radio' || el.type === 'checkbox') onChoice(el);
    });

    form.addEventListener('input', function (ev) {
      var el = ev.target;
      if (el.dataset.other) {
        state.answers[el.dataset.other + '_other'] = el.value;
        refresh();
      } else if (el.dataset.text) {
        state.answers[el.dataset.text] = el.value;
        var q = Survey.byId(el.dataset.text);
        var c = $('[data-count="' + q.id + '"]');
        if (c) {
          c.textContent = el.value.length;
          c.parentNode.classList.toggle('is-near', el.value.length > (q.maxLength || 1000) * 0.9);
        }
        refresh();
      }
    });

    // 在「其他」的輸入框按 Enter 不要直接把整份問卷送出去
    form.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && ev.target.type === 'text') {
        ev.preventDefault();
        ev.target.blur();
      }
    });

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      submit();
    });

    // 清除重填：按一次變成「再按一次確認」，避免手滑
    var clearBtn = document.getElementById('clearBtn');
    var armTimer = null;
    clearBtn.onclick = function () {
      if (!clearBtn.classList.contains('is-armed')) {
        clearBtn.classList.add('is-armed');
        clearBtn.textContent = '再按一次，確定清除所有答案';
        armTimer = setTimeout(function () {
          clearBtn.classList.remove('is-armed');
          clearBtn.textContent = '清除重填';
        }, 3500);
        return;
      }
      clearTimeout(armTimer);
      clearDraft();
      state.answers = {};
      state.attempted = false;
      renderForm();
      refresh();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      toast('已清除，可以重新填寫');
    };
  }

  /* ================= 進度、錯誤提示 ================= */

  var GROWTH = ['🌱', '🌿', '🪻', '🌷', '🌸'];

  function paintGrowth(ratio) {
    var i = ratio >= 1 ? 4 : Math.min(3, Math.floor(ratio * 4));
    var emo = GROWTH[i];
    var mark = document.getElementById('growMark');
    if (mark && mark.textContent !== emo) {
      mark.textContent = emo;
      mark.classList.remove('pop');
      void mark.offsetWidth;
      mark.classList.add('pop');
      var icon = document.querySelector('link[rel="icon"]');
      if (icon) {
        icon.href = 'data:image/svg+xml,' + encodeURIComponent(
          "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>" + emo + '</text></svg>');
      }
    }
  }

  function paintProgress(done, total) {
    document.getElementById('progressText').textContent = done + ' / ' + total;
    document.getElementById('progressFill').style.width = (total ? done / total * 100 : 0) + '%';
    document.getElementById('progressChip').classList.toggle('is-full', total > 0 && done === total);
    paintGrowth(total ? done / total : 0);
  }

  /** 每次作答後重算：進度、哪幾題填好了、（按過送出後）哪幾題還缺 */
  function refresh() {
    var errors = Survey.validate(state.answers);
    var total = 0, done = 0;

    Survey.questions.forEach(function (q) {
      var card = cardOf(q.id);
      if (!card) return;
      var shown = Survey.visible(q, state.answers);
      var err = errors[q.id];
      var answered = hasAnswer(q);

      if (shown && q.required) {
        total++;
        if (!err) done++;
      }
      card.classList.toggle('is-done', shown && !err && (q.required || answered));

      var showErr = state.attempted && shown && !!err;
      card.classList.toggle('has-err', showErr);
      var errEl = document.getElementById('qe-' + q.id);
      errEl.hidden = !showErr;
      errEl.textContent = showErr ? err : '';

      if (q.type === 'matrix') {
        var v = state.answers[q.id] || [];
        $$('.mx-row', card).forEach(function (row, r) {
          row.classList.toggle('is-missing', state.attempted && !v[r]);
        });
      }
    });

    paintProgress(done, total);

    var note = document.getElementById('missingNote');
    if (note) {
      var left = keys(errors).length;
      note.hidden = !state.attempted || !left;
      note.textContent = left ? '還有 ' + left + ' 題沒有填完' : '';
    }

    saveDraft();
    return errors;
  }

  function hasAnswer(q) {
    var v = state.answers[q.id];
    if (q.type === 'text') return !!(v && String(v).trim());
    if (q.type === 'multi' || q.type === 'matrix') return !!(v && v.length);
    return v !== undefined && v !== null;
  }

  /* ================= 恢復草稿 ================= */

  function restore(saved) {
    if (!saved) return false;
    var any = false;
    Survey.questions.forEach(function (q) {
      var v = saved[q.id];
      var card = cardOf(q.id);
      if (!card || v === undefined || v === null) return;
      // 條件題要看「已經還原的」上一題答案決定要不要還原（題目順序保證上一題先處理）
      if (!Survey.visible(q, state.answers)) return;

      if (q.type === 'single' || q.type === 'multi') {
        var vals = q.type === 'single' ? [v] : (Object.prototype.toString.call(v) === '[object Array]' ? v : []);
        if (q.type === 'single') vals = vals.slice(0, 1);
        vals.forEach(function (x) {
          var el = $('input[name="' + q.id + '"][value="' + (+x) + '"]', card);
          if (el) { el.checked = true; any = true; }
        });
        var got = checkedValues(q.id);
        if (q.type === 'single') { if (got.length) state.answers[q.id] = got[0]; }
        else state.answers[q.id] = got;
        var ot = saved[q.id + '_other'];
        if (typeof ot === 'string' && ot) {
          state.answers[q.id + '_other'] = ot;
          var oi = $('[data-other="' + q.id + '"]');
          if (oi) oi.value = ot;
        }
      } else if (q.type === 'matrix' && Object.prototype.toString.call(v) === '[object Array]') {
        var arr = [];
        q.rows.forEach(function (_, r) {
          var x = +v[r];
          var el = x ? $('input[data-mx="' + q.id + '"][data-row="' + r + '"][value="' + x + '"]', card) : null;
          if (el) { el.checked = true; arr.push(x); any = true; } else arr.push(null);
        });
        state.answers[q.id] = arr;
      } else if (q.type === 'text' && typeof v === 'string') {
        var ta = $('[data-text="' + q.id + '"]', card);
        ta.value = v.slice(0, q.maxLength || 1000);
        state.answers[q.id] = ta.value;
        var c = $('[data-count="' + q.id + '"]');
        if (c) c.textContent = ta.value.length;
        if (ta.value) any = true;
      }
    });

    // 依序處理，條件題（族別）要等上一題（族群）的答案還原之後才會出現
    Survey.questions.forEach(function (q) {
      syncOptions(q);
      syncOther(q);
    });
    syncVisibility();
    Survey.questions.forEach(function (q) { syncOptions(q); syncOther(q); });
    return any;
  }

  /* ================= 送出 ================= */

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /**
   * 送到 Apps Script。Content-Type 一定要用 text/plain，
   * 不然瀏覽器會先送 OPTIONS 預檢，Apps Script 不支援就直接變 CORS 錯誤。
   *
   * 網路斷掉可以放心重送：後端會用裝置 ID 擋掉重複的那一筆。
   */
  function post(body, attempt) {
    attempt = attempt || 0;
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 30000) : null;
    var opts = {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    };
    if (ctrl) opts.signal = ctrl.signal;

    return fetch(cfg.GAS_URL, opts)
      .then(function (res) {
        if (timer) clearTimeout(timer);
        if (!res.ok) {
          var e = new Error('伺服器暫時沒有回應（HTTP ' + res.status + '）');
          e.retry = res.status === 404 || res.status === 408 || res.status === 429 || res.status >= 500;
          throw e;
        }
        return res.text();
      }, function (err) {
        if (timer) clearTimeout(timer);
        var e = new Error(err && err.name === 'AbortError'
          ? '伺服器太久沒有回應，請再按一次送出'
          : '連不上網路，請確認訊號後再按一次送出');
        e.retry = true;
        throw e;
      })
      .then(function (text) {
        var data;
        try { data = JSON.parse(text); }
        catch (x) {
          throw new Error(/Google Drive|需要權限|Authorization|登入|sign in/i.test(text)
            ? '後端權限設定有誤：部署時「具有存取權的使用者」要選「所有人」'
            : '伺服器回傳的格式不對');
        }
        if (!data.ok) {
          var e = new Error(data.error || '送出失敗');
          e.code = data.code;
          e.fields = data.fields;
          e.attempt = attempt;
          e.retry = data.code === 'BUSY';   // 同時送出的人太多、排不到鎖 → 等一下自動再送
          throw e;
        }
        return data;
      })
      .catch(function (e) {
        if (e.retry && attempt < 2) {
          return wait(700 * (attempt + 1)).then(function () { return post(body, attempt + 1); });
        }
        throw e;
      });
  }

  function setBusy(on) {
    state.busy = on;
    var btn = document.getElementById('submitBtn');
    if (!btn) return;
    btn.disabled = on;
    btn.innerHTML = on ? '<span class="spinner"></span>送出中…' : '送出問卷';
  }

  function jumpTo(qid) {
    var card = cardOf(qid);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    card.classList.remove('flash');
    void card.offsetWidth;
    card.classList.add('flash');
  }

  function firstError(errors) {
    for (var i = 0; i < Survey.questions.length; i++) {
      if (errors[Survey.questions[i].id]) return Survey.questions[i].id;
    }
    return null;
  }

  function submit() {
    if (state.busy) return;
    state.attempted = true;
    var errors = refresh();
    var bad = firstError(errors);
    if (bad) {
      var n = keys(errors).length;
      toast(n === 1 ? '還有 1 題沒有填完' : '還有 ' + n + ' 題沒有填完', 'err', 2600);
      jumpTo(bad);
      return;
    }

    if (Device.done()) return showDone('already');

    if (!cfg.GAS_URL || cfg.GAS_URL.indexOf('請貼上') > -1) {
      toast('還沒設定後端網址（js/config.js 的 GAS_URL）', 'err');
      return;
    }

    setBusy(true);
    post({
      action: 'submit',
      version: Survey.version,
      deviceId: Device.id(),
      answers: state.answers
    })
      .then(function () {
        Device.markDone(submittedName());
        clearDraft();
        showDone('thanks');
      })
      .catch(function (e) {
        setBusy(false);
        if (e.code === 'DUPLICATE') {
          // 重送的時候才撞到重複 → 代表第一次其實已經送到了，名字就是這次填的。
          // 一開始就撞到 → 是以前填過的，那時候填什麼名字不知道，就不要記錯的名字
          var ours = e.attempt > 0;
          Device.markDone(ours ? submittedName() : '');
          clearDraft();
          return showDone(ours ? 'thanks' : 'already');
        }
        if (e.code === 'INVALID' && e.fields && keys(e.fields).length) {
          refresh();
          toast(e.message, 'err');
          jumpTo(firstError(e.fields) || keys(e.fields)[0]);
          return;
        }
        if (e.code === 'VERSION') {
          toast('問卷剛剛更新過，請重新整理頁面再送出（已填的答案會保留）', 'err', 6000);
          return;
        }
        toast(e.message || '送出失敗，請再試一次', 'err');
      });
  }

  /* ================= 填完的畫面 ================= */

  function submittedName() {
    return String(state.answers.name || '').replace(/\s+/g, ' ').trim();
  }

  /* 服務台領獎：小熊軟糖一份＋扭蛋一次＋百元禮券抽獎（文字跟攤位簡介一致） */
  var DESK = '<strong>服務台</strong><span class="nw">（A1 攤位旁）</span>';
  var PERKS =
    '<ul class="perks">' +
      '<li><span class="pk-ico" aria-hidden="true">🎁</span><span>可愛<b>小熊軟糖</b>一份</span></li>' +
      '<li><span class="pk-ico" aria-hidden="true">🎯</span><span>驚喜<b>扭蛋</b>轉一次</span></li>' +
      '<li><span class="pk-ico" aria-hidden="true">💰</span><span><b>百元禮券</b>等你抽！</span></li>' +
    '</ul>';

  function showDone(kind) {
    var thanks = kind === 'thanks';
    var name = Device.name();
    paintProgress(1, 1);
    document.getElementById('progressChip').innerHTML = '<b>' + (thanks ? '已送出' : '已填寫') + '</b>';

    var nameBox = name
      ? '<div class="claim-name"><span class="cn-label">到服務台報上</span><b class="cn-name">' + esc(name) + '</b></div>'
      : '';

    app.innerHTML =
      '<section class="card done-card">' +
        '<span class="done-emoji">🌸</span>' +
        (thanks
          ? '<h1>感謝您的填答！</h1>' +
            '<p>問卷已經送出囉！現在就到' + DESK + '報上您的名字，就能領好禮、試手氣：</p>'
          : '<h1>這支手機已經填過問卷囉</h1>' +
            '<p>每支手機只能填寫一次，謝謝您的參與！</p>' +
            '<p>還沒去領獎的話，到' + DESK + '報上填問卷時的名字就可以了：</p>') +
        nameBox +
        PERKS +
        '<p class="done-foot">填問卷、拿好禮、試手氣，幸運得主就是你！</p>' +
        (cfg.HOME_URL
          ? '<div class="btn-row"><a class="btn btn-green" href="' + esc(cfg.HOME_URL) + '">回到攤位報名系統</a></div>'
          : '') +
        (cfg.TEST_MODE
          ? '<div class="test-tools">' +
              '<button type="button" class="btn btn-ghost" id="resetDevice">' + RESET_LABEL + '</button></div>'
          : '') +
      '</section>';

    var reset = document.getElementById('resetDevice');
    if (reset) bindReset(reset);

    window.scrollTo(0, 0);
  }

  /* ================= 測試模式：刪掉這支手機的紀錄 =================
   * 只有 config.js 的 TEST_MODE 打開才看得到這顆按鈕。
   * 不管之前那一筆是不是在測試模式下填的，只要是「這支手機」送出的，
   * 都會從試算表刪掉，手機上的「已填過」也一起清掉，可以重新填。
   */
  var RESET_LABEL = '刪除這支手機的紀錄，再填一次';

  function bindReset(btn) {
    var armTimer = null;

    btn.onclick = function () {
      // 會刪試算表的資料，所以要按兩次
      if (!btn.classList.contains('is-armed')) {
        btn.classList.add('is-armed');
        btn.textContent = '再按一次，確定刪除試算表裡的紀錄';
        armTimer = setTimeout(function () {
          btn.classList.remove('is-armed');
          btn.textContent = RESET_LABEL;
        }, 4000);
        return;
      }
      clearTimeout(armTimer);
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>刪除中…';

      var configured = cfg.GAS_URL && cfg.GAS_URL.indexOf('請貼上') === -1;
      var job = configured
        ? post({ action: 'resetDevice', deviceId: Device.id() })
        : Promise.resolve({ deleted: 0 });

      job.then(function (res) {
        var n = (res && res.deleted) || 0;
        Device.reset();
        flash(n ? '已從試算表刪除這支手機的 ' + n + ' 筆紀錄，可以重新填了'
                : '試算表裡沒有這支手機的紀錄，已重設，可以重新填了');
        location.reload();
      }).catch(function (e) {
        btn.disabled = false;
        btn.classList.remove('is-armed');
        btn.textContent = RESET_LABEL;
        // Apps Script 還是舊版（沒有 resetDevice）
        if (/未知的動作/.test(e.message)) {
          toast('後端還是舊版：請把新的 Code.gs 貼進 Apps Script，並「管理部署作業 → 編輯 → 新版本」重新部署', 'err', 8000);
        } else {
          toast('刪除失敗：' + e.message, 'err');
        }
      });
    };
  }

  /* 重新整理之後才顯示的提示（toast 本身會跟著頁面一起不見） */
  function flash(msg) {
    try { sessionStorage.setItem(KEY + 'flash', msg); } catch (e) { /* 忽略 */ }
  }
  function takeFlash() {
    try {
      var m = sessionStorage.getItem(KEY + 'flash');
      sessionStorage.removeItem(KEY + 'flash');
      return m;
    } catch (e) { return null; }
  }

  /* ================= 啟動 ================= */

  /* 問卷如果跟攤位報名系統放在同一個網域（例如 …github.io/報名系統/survey/），
     玩家報名攤位時填過的名字（fju_me）這裡讀得到，就先幫他填好。讀不到就算了。 */
  function prefillName() {
    if (state.answers.name) return;
    var input = $('[data-text="name"]');
    if (!input) return;
    try {
      var me = JSON.parse(localStorage.getItem('fju_me') || 'null');
      var n = me && typeof me.name === 'string' ? me.name.trim().slice(0, 20) : '';
      if (n) { input.value = n; state.answers.name = n; }
    } catch (e) { /* 沒有就算了 */ }
  }

  function start() {
    Device.id();   // 一打開就把裝置 ID 定下來
    var msg = takeFlash();

    if (Device.done()) { showDone('already'); return; }

    renderForm();
    var restored = restore(loadDraft());
    prefillName();
    refresh();
    if (msg) toast(msg, 'ok', 4000);
    else if (restored) toast('已幫您恢復上次填到一半的答案');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
