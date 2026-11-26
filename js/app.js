/* Hedaf — UI layer. Talks to HedafCore + localStorage. */
(function () {
  'use strict';
  var C = window.HedafCore;
  var I = window.HedafI18N;

  var state = load();
  var editingGoalId = null;
  var txGoalId = null;

  /* ---------- persistence ---------- */
  function load() {
    try {
      var raw = localStorage.getItem(C.STORAGE_KEY);
      if (raw) return C.deserialize(raw);
    } catch (e) { /* corrupted storage -> start fresh */ }
    return C.emptyState();
  }
  function save() {
    localStorage.setItem(C.STORAGE_KEY, C.serialize(state));
  }

  /* ---------- helpers ---------- */
  var $ = function (sel) { return document.querySelector(sel); };
  var lang = function () { return state.settings.lang; };
  var t = function (k) { return I.t(lang(), k); };

  function fmt(n, withCurrency) {
    var v = Number(n) || 0;
    var s = v.toLocaleString(lang() === 'ar' ? 'ar-EG' : 'en-US', { maximumFractionDigits: 2 });
    return withCurrency === false ? s : s + ' ' + state.settings.currency;
  }
  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
    return d.toLocaleDateString(lang() === 'ar' ? 'ar-EG' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function ringSVG(pct, size, stroke, accent) {
    var r = (size - stroke) / 2;
    var circ = 2 * Math.PI * r;
    var off = circ * (1 - Math.min(1, Math.max(0, pct)));
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" class="ring">' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="rgba(255,255,255,.10)" stroke-width="' + stroke + '"/>' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="' + accent + '" stroke-width="' + stroke +
      '" stroke-linecap="round" stroke-dasharray="' + circ + '" stroke-dashoffset="' + off +
      '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/></svg>';
  }

  var PACE_CLASS = { ahead: 'good', 'on-track': 'ok', behind: 'bad', overdue: 'bad', done: 'good', flexible: 'muted' };
  var PACE_KEY = { ahead: 'paceAhead', 'on-track': 'paceOnTrack', behind: 'paceBehind', overdue: 'overdue', done: 'done', flexible: 'paceFlexible' };

  /* ---------- render ---------- */
  function render() {
    document.documentElement.lang = lang();
    document.documentElement.dir = I.dir(lang());
    renderHeader();
    renderSummary();
    renderGoals();
    renderPlan();
    $('#langBtn').textContent = t('language');
    $('#currencyInput').value = state.settings.currency;
    document.title = t('appName') + ' — ' + t('tagline');
    save();
  }

  function renderHeader() {
    $('#tagline').textContent = t('tagline');
    $('#addGoalBtn').textContent = '＋ ' + t('addGoal');
    $('#exportBtn').textContent = t('export');
    $('#importBtn').textContent = t('import');
    $('#localNote').textContent = '🔒 ' + t('localNote');
  }

  function renderSummary() {
    var sum = C.summarize(state.goals, null, new Date());
    var pctTxt = Math.round(sum.overall * 100) + '%';
    $('#totalRing').innerHTML = ringSVG(sum.overall, 132, 11, 'url(#gradGold)') +
      '<div class="ring-center"><strong>' + pctTxt + '</strong><span>' + esc(t('totalSaved')) + '</span></div>';
    $('#totalSavedTxt').innerHTML = '<strong>' + fmt(sum.totalSaved) + '</strong> ' + esc(t('ofTarget')) + ' ' + fmt(sum.totalTarget);
    $('#perWeekTxt').textContent = fmt(sum.perWeek) + ' ' + t('perWeek');
    $('#statActive').textContent = sum.active;
    $('#statDone').textContent = sum.done;
    $('#lblActive').textContent = t('activeGoals');
    $('#lblDone').textContent = t('doneGoals');
    $('#lblPerWeek').textContent = t('perWeekAll');
  }

  function goalCard(g) {
    var p = C.progress(g);
    var need = C.weeklyNeed(g, new Date());
    var pace = C.paceStatus(g, new Date());
    var proj = C.projectedDate(g, state.txs.filter(function (x) { return x.goalId === g.id; }), new Date());
    var ms = C.milestoneState(g);
    var html = '<article class="card" data-id="' + g.id + '">';
    html += '<div class="card-top"><span class="gicon">' + g.icon + '</span>' +
      '<div class="gtitle"><h3>' + esc(g.name) + '</h3>' +
      '<span class="badge ' + PACE_CLASS[pace] + '">' + esc(t(PACE_KEY[pace])) + '</span></div>' +
      '<div class="gring">' + ringSVG(p, 64, 6, p >= 1 ? '#34d399' : '#f2b33d') +
      '<b>' + Math.round(p * 100) + '%</b></div></div>';
    html += '<div class="gmoney"><strong>' + fmt(g.saved) + '</strong> / ' + fmt(g.target) + '</div>';
    if (need.done) {
      html += '<p class="done-line">' + esc(t('goalDoneMsg')) + '</p>';
    } else if (need.perWeek != null) {
      html += '<p class="need">' + esc(t('weeklyNeed')) + ' <strong>' + fmt(need.perWeek) + '</strong> ' + esc(t('perWeek')) +
        ' · ' + need.weeksLeft + ' ' + esc(t('weeksLeft')) + '</p>';
    } else {
      html += '<p class="need muted">' + esc(t('noDeadline')) + '</p>';
    }
    if (!need.done) {
      html += '<p class="proj muted">' + (proj.date ? esc(t('projected')) + ': ' + fmtDate(proj.date) : esc(t('noProjection'))) + '</p>';
    }
    html += '<div class="ms">' + ms.map(function (m) {
      return '<span class="pip' + (m.reached ? ' hit' : '') + '">' + m.pct + '%</span>';
    }).join('') + '</div>';
    html += '<div class="actions">' +
      '<button class="btn gold" data-act="deposit">＋ ' + esc(t('deposit')) + '</button>' +
      '<button class="btn ghost" data-act="withdraw">− ' + esc(t('withdraw')) + '</button>' +
      '<button class="btn ghost" data-act="history">🧾 ' + esc(t('history')) + '</button>' +
      '<button class="btn ghost" data-act="edit">✎ ' + esc(t('edit')) + '</button>' +
      '<button class="btn danger" data-act="delete">🗑</button>' +
      '</div></article>';
    return html;
  }

  function renderGoals() {
    var wrap = $('#goals');
    if (!state.goals.length) {
      wrap.innerHTML = '<div class="empty"><div class="empty-art">🎯</div><h2>' + esc(t('emptyTitle')) + '</h2><p>' +
        esc(t('emptyBody')) + '</p><button class="btn gold big" id="emptyAdd">' + esc(t('emptyCta')) + '</button></div>';
      $('#emptyAdd').addEventListener('click', function () { openGoalModal(null); });
      return;
    }
    wrap.innerHTML = state.goals.map(goalCard).join('');
    wrap.querySelectorAll('.card').forEach(function (card) {
      var id = card.getAttribute('data-id');
      card.querySelectorAll('[data-act]').forEach(function (btn) {
        btn.addEventListener('click', function () { onGoalAction(id, btn.getAttribute('data-act')); });
      });
    });
  }

  function renderPlan() {
    var wrap = $('#planWrap');
    $('#planTitle').textContent = '📅 ' + t('planFor');
    var active = state.goals.filter(function (g) { return C.progress(g) < 1; });
    if (!active.length) { wrap.innerHTML = ''; return; }
    // aggregate weekly required across goals, next 12 weeks
    var weeks = 12;
    var totals = new Array(weeks).fill(0);
    active.forEach(function (g) {
      C.planSchedule(g, new Date(), weeks).forEach(function (row, i) { totals[i] += row.deposit; });
    });
    var max = Math.max.apply(null, totals.concat([1]));
    var bars = totals.map(function (v, i) {
      var h = Math.round((v / max) * 100);
      return '<div class="bar-col"><div class="bar" style="height:' + Math.max(3, h) + '%" title="' +
        esc(t('week')) + ' ' + (i + 1) + ': ' + fmt(v) + '"></div><span>' + (i + 1) + '</span></div>';
    }).join('');
    wrap.innerHTML = '<div class="bars">' + bars + '</div>' +
      '<p class="muted center">' + esc(t('perWeekAll')) + ': <strong>' + fmt(totals[0]) + '</strong> ' + esc(t('perWeek')) + '</p>';
  }

  /* ---------- goal modal ---------- */
  function openGoalModal(goal) {
    editingGoalId = goal ? goal.id : null;
    $('#goalModalTitle').textContent = goal ? t('editGoal') : t('newGoal');
    $('#fName').value = goal ? goal.name : '';
    $('#fTarget').value = goal ? goal.target : '';
    $('#fSaved').value = goal ? goal.saved : '';
    $('#fDeadline').value = goal && goal.deadline ? goal.deadline : '';
    var iconWrap = $('#iconPick');
    iconWrap.innerHTML = '';
    C.PRESETS.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'icon-opt' + ((goal ? goal.icon : '🎯') === p.icon ? ' sel' : '');
      b.textContent = p.icon;
      b.title = lang() === 'ar' ? p.name.ar : p.name.en;
      b.addEventListener('click', function () {
        iconWrap.querySelectorAll('.icon-opt').forEach(function (x) { x.classList.remove('sel'); });
        b.classList.add('sel');
        if (!goal && (!$('#fName').value || isPresetName($('#fName').value))) $('#fName').value = lang() === 'ar' ? p.name.ar : p.name.en;
      });
      iconWrap.appendChild(b);
    });
    // labels
    $('#lblName').textContent = t('goalName');
    $('#lblTarget').textContent = t('targetAmount');
    $('#lblSaved').textContent = t('savedSoFar');
    $('#lblDeadline').textContent = t('deadline');
    $('#lblIcon').textContent = t('pickIcon');
    $('#goalSave').textContent = t('save');
    $('#goalCancel').textContent = t('cancel');
    showModal('#goalModal');
  }
  function isPresetName(v) {
    return C.PRESETS.some(function (p) { return p.name.ar === v || p.name.en === v; });
  }

  function saveGoalFromModal() {
    var name = $('#fName').value.trim();
    var target = Number($('#fTarget').value);
    if (!name || !isFinite(target) || target <= 0) {
      $('#fName').classList.toggle('err', !name);
      $('#fTarget').classList.toggle('err', !isFinite(target) || target <= 0);
      return;
    }
    var icon = ($('#iconPick .icon-opt.sel') || {}).textContent || '🎯';
    if (editingGoalId) {
      var g = state.goals.find(function (x) { return x.id === editingGoalId; });
      if (g) {
        g.name = name; g.icon = icon; g.target = C.round2(target);
        g.saved = C.round2(C.clamp(Number($('#fSaved').value) || 0, 0, g.target));
        g.deadline = $('#fDeadline').value || null;
      }
    } else {
      state.goals.push(C.makeGoal({
        name: name, icon: icon, target: target,
        saved: Number($('#fSaved').value) || 0,
        deadline: $('#fDeadline').value || null
      }));
    }
    hideModal('#goalModal');
    render();
  }

  /* ---------- transaction modal ---------- */
  var txSign = 1;
  function openTxModal(goalId, sign) {
    txGoalId = goalId; txSign = sign;
    var g = state.goals.find(function (x) { return x.id === goalId; });
    $('#txModalTitle').textContent = (sign > 0 ? t('deposit') : t('withdraw')) + ' — ' + (g ? g.name : '');
    $('#lblAmount').textContent = t('amount');
    $('#lblNote').textContent = t('note');
    $('#txAmount').value = '';
    $('#txNote').value = '';
    $('#txSave').textContent = t('save');
    $('#txCancel').textContent = t('cancel');
    showModal('#txModal');
    setTimeout(function () { $('#txAmount').focus(); }, 50);
  }
  function saveTxFromModal() {
    var amount = Number($('#txAmount').value);
    if (!isFinite(amount) || amount <= 0) { $('#txAmount').classList.add('err'); return; }
    var g = state.goals.find(function (x) { return x.id === txGoalId; });
    if (!g) return;
    var wasDone = C.progress(g) >= 1;
    C.applyTx(state, C.makeTx(txGoalId, txSign * amount, C.todayISO(), $('#txNote').value.trim()));
    hideModal('#txModal');
    render();
    if (!wasDone && C.progress(g) >= 1) confetti();
  }

  /* ---------- history modal ---------- */
  function openHistory(goalId) {
    var g = state.goals.find(function (x) { return x.id === goalId; });
    $('#histModalTitle').textContent = '🧾 ' + t('history') + ' — ' + (g ? g.name : '');
    var rows = state.txs.filter(function (x) { return x.goalId === goalId; })
      .sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    $('#histBody').innerHTML = rows.length ? rows.map(function (x) {
      return '<div class="hrow"><span class="hamt ' + (x.amount >= 0 ? 'pos' : 'neg') + '">' +
        (x.amount >= 0 ? '+' : '') + fmt(x.amount) + '</span><span class="hdate">' + fmtDate(x.date) + '</span>' +
        (x.note ? '<span class="hnote">' + esc(x.note) + '</span>' : '') + '</div>';
    }).join('') : '<p class="muted center">' + esc(t('noHistory')) + '</p>';
    $('#histClose').textContent = t('close');
    showModal('#histModal');
  }

  /* ---------- actions ---------- */
  function onGoalAction(id, act) {
    if (act === 'deposit') openTxModal(id, 1);
    else if (act === 'withdraw') openTxModal(id, -1);
    else if (act === 'history') openHistory(id);
    else if (act === 'edit') openGoalModal(state.goals.find(function (x) { return x.id === id; }));
    else if (act === 'delete') {
      if (confirm(t('confirmDelete'))) {
        state.goals = state.goals.filter(function (x) { return x.id !== id; });
        state.txs = state.txs.filter(function (x) { return x.goalId !== id; });
        render();
      }
    }
  }

  /* ---------- modal plumbing ---------- */
  function showModal(sel) { $(sel).classList.add('open'); }
  function hideModal(sel) { $(sel).classList.remove('open'); }

  /* ---------- export / import ---------- */
  function doExport() {
    var blob = new Blob([C.serialize(state)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'hedaf-backup-' + C.todayISO() + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function doImport(file) {
    var r = new FileReader();
    r.onload = function () {
      try {
        state = C.deserialize(String(r.result));
        render();
        toast(t('importOk'), true);
      } catch (e) {
        toast(t('importBad'), false);
      }
    };
    r.readAsText(file);
  }

  function toast(msg, ok) {
    var el = $('#toast');
    el.textContent = msg;
    el.className = 'toast show ' + (ok ? 'good' : 'bad');
    setTimeout(function () { el.className = 'toast'; }, 2600);
  }

  /* ---------- confetti ---------- */
  function confetti() {
    var cv = $('#confetti');
    var ctx = cv.getContext('2d');
    cv.width = innerWidth; cv.height = innerHeight;
    var parts = [];
    var colors = ['#f2b33d', '#2dd4bf', '#34d399', '#f472b6', '#f8fafc'];
    for (var i = 0; i < 140; i++) {
      parts.push({ x: innerWidth / 2, y: innerHeight / 3, vx: (Math.random() - 0.5) * 14, vy: Math.random() * -11 - 2,
        s: Math.random() * 7 + 3, c: colors[i % colors.length], r: Math.random() * Math.PI });
    }
    var frames = 0;
    (function tick() {
      ctx.clearRect(0, 0, cv.width, cv.height);
      parts.forEach(function (p) {
        p.x += p.vx; p.y += p.vy; p.vy += 0.35; p.r += 0.1;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
        ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
        ctx.restore();
      });
      if (++frames < 110) requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, cv.width, cv.height);
    })();
  }

  /* ---------- wire up ---------- */
  function init() {
    $('#addGoalBtn').addEventListener('click', function () { openGoalModal(null); });
    $('#goalSave').addEventListener('click', saveGoalFromModal);
    $('#goalCancel').addEventListener('click', function () { hideModal('#goalModal'); });
    $('#txSave').addEventListener('click', saveTxFromModal);
    $('#txCancel').addEventListener('click', function () { hideModal('#txModal'); });
    $('#histClose').addEventListener('click', function () { hideModal('#histModal'); });
    $('#exportBtn').addEventListener('click', doExport);
    $('#importBtn').addEventListener('click', function () { $('#importFile').click(); });
    $('#importFile').addEventListener('change', function (e) {
      if (e.target.files[0]) doImport(e.target.files[0]);
      e.target.value = '';
    });
    $('#langBtn').addEventListener('click', function () {
      state.settings.lang = lang() === 'ar' ? 'en' : 'ar';
      render();
    });
    $('#currencyInput').addEventListener('change', function () {
      state.settings.currency = ($('#currencyInput').value.trim() || 'EGP').toUpperCase().slice(0, 6);
      render();
    });
    document.querySelectorAll('.modal').forEach(function (m) {
      m.addEventListener('click', function (e) { if (e.target === m) m.classList.remove('open'); });
    });
    ['#fName', '#fTarget', '#txAmount'].forEach(function (sel) {
      $(sel).addEventListener('input', function () { $(sel).classList.remove('err'); });
    });
    render();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
