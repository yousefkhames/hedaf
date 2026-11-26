/*
 * Hedaf — core logic.
 * Pure functions + state model. No DOM, no localStorage here so the same
 * module runs in the browser and in Node for tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HedafCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  var DAY_MS = 24 * 60 * 60 * 1000;
  var STORAGE_KEY = 'hedaf.v1';
  var DEFAULT_WINDOW_WEEKS = 8;

  var PRESETS = [
    { id: 'phone',   icon: '📱', name: { ar: 'موبايل',  en: 'Phone' } },
    { id: 'car',     icon: '🚗', name: { ar: 'عربية',   en: 'Car' } },
    { id: 'hajj',    icon: '🕋', name: { ar: 'حج',      en: 'Hajj' } },
    { id: 'umrah',   icon: '🕌', name: { ar: 'عمرة',    en: 'Umrah' } },
    { id: 'laptop',  icon: '💻', name: { ar: 'لابتوب',  en: 'Laptop' } },
    { id: 'wedding', icon: '💍', name: { ar: 'فرح',     en: 'Wedding' } },
    { id: 'travel',  icon: '✈️', name: { ar: 'سفر',     en: 'Travel' } },
    { id: 'home',    icon: '🏠', name: { ar: 'شقة',     en: 'Home' } },
    { id: 'custom',  icon: '🎯', name: { ar: 'هدف آخر', en: 'Custom' } }
  ];

  var MILESTONES = [25, 50, 75, 100];

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' +
      Math.random().toString(36).slice(2, 8);
  }

  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  function toDateOnly(d) {
    var dt = (d instanceof Date) ? d : new Date(d);
    return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  }

  function todayISO(now) {
    var d = toDateOnly(now || new Date());
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  /* ---------- goals & transactions ---------- */

  function makeGoal(input, now) {
    var goal = {
      id: uid('g'),
      name: String(input.name || '').trim(),
      icon: input.icon || '🎯',
      target: round2(Math.max(0, Number(input.target) || 0)),
      saved: round2(Math.max(0, Number(input.saved) || 0)),
      deadline: input.deadline || null, // 'YYYY-MM-DD' or null
      createdAt: (now ? new Date(now) : new Date()).toISOString()
    };
    return goal;
  }

  function makeTx(goalId, amount, date, note) {
    return {
      id: uid('t'),
      goalId: goalId,
      amount: round2(Number(amount)), // + deposit, - withdrawal
      date: date || todayISO(),
      note: note ? String(note).slice(0, 140) : ''
    };
  }

  function progress(goal) {
    if (!goal.target || goal.target <= 0) return goal.saved > 0 ? 1 : 0;
    return clamp(goal.saved / goal.target, 0, 1);
  }

  /* ---------- weekly plan ---------- */

  // How much must be saved per week to hit the deadline.
  // weeksLeft counts calendar weeks from now until the deadline (ceil, min 0).
  function weeklyNeed(goal, now) {
    var remaining = round2(Math.max(0, goal.target - goal.saved));
    var done = remaining === 0;
    if (done) return { done: true, remaining: 0, weeksLeft: 0, perWeek: 0, overdue: false };
    if (!goal.deadline) {
      return { done: false, remaining: remaining, weeksLeft: null, perWeek: null, overdue: false };
    }
    var end = toDateOnly(goal.deadline).getTime();
    var start = toDateOnly(now || new Date()).getTime();
    var weeksLeft = Math.ceil((end - start) / WEEK_MS);
    if (weeksLeft <= 0) {
      return { done: false, remaining: remaining, weeksLeft: 0, perWeek: remaining, overdue: true };
    }
    return { done: false, remaining: remaining, weeksLeft: weeksLeft, perWeek: round2(remaining / weeksLeft), overdue: false };
  }

  // Average weekly savings from transaction history over a trailing window.
  function avgWeeklyRate(txs, now, windowWeeks) {
    var w = windowWeeks || DEFAULT_WINDOW_WEEKS;
    var end = toDateOnly(now || new Date()).getTime() + DAY_MS;
    var start = end - w * WEEK_MS;
    var sum = 0;
    (txs || []).forEach(function (t) {
      var ts = toDateOnly(t.date).getTime();
      if (ts >= start && ts < end) sum += Number(t.amount) || 0;
    });
    if (sum <= 0) return 0;
    return round2(sum / w);
  }

  // Projected completion date at the recent pace. null when pace is zero/negative.
  function projectedDate(goal, txs, now) {
    var remaining = goal.target - goal.saved;
    if (remaining <= 0) return { done: true, date: null, weeksNeeded: 0 };
    var rate = avgWeeklyRate(txs, now);
    if (rate <= 0) return { done: false, date: null, weeksNeeded: null, rate: 0 };
    var weeksNeeded = remaining / rate;
    var d = new Date(toDateOnly(now || new Date()).getTime() + weeksNeeded * WEEK_MS);
    return { done: false, date: d.toISOString().slice(0, 10), weeksNeeded: round2(weeksNeeded), rate: rate };
  }

  // Linear pace check between createdAt and deadline.
  function paceStatus(goal, now) {
    if (progress(goal) >= 1) return 'done';
    if (!goal.deadline) return 'flexible';
    var start = toDateOnly(goal.createdAt).getTime();
    var end = toDateOnly(goal.deadline).getTime();
    var nowMs = toDateOnly(now || new Date()).getTime();
    if (nowMs >= end) return 'overdue';
    if (end <= start) return 'on-track';
    var elapsed = clamp((nowMs - start) / (end - start), 0, 1);
    var expected = elapsed; // linear expectation
    var actual = progress(goal);
    var slack = 0.08; // 8 percentage points of tolerance
    if (actual >= expected + slack) return 'ahead';
    if (actual >= expected - slack) return 'on-track';
    return 'behind';
  }

  // Single source for "what this goal costs per week": the deadline-based
  // need when there is one, otherwise the remaining spread over the
  // planning horizon (12 weeks) so dashboard and chart always agree.
  var PLAN_HORIZON_WEEKS = 12;
  function effectivePerWeek(goal, now) {
    var need = weeklyNeed(goal, now);
    if (need.done) return 0;
    if (need.perWeek != null) return need.perWeek;
    return round2(need.remaining / PLAN_HORIZON_WEEKS);
  }

  /* ---------- plan table for the next N weeks ---------- */

  // Builds a week-by-week plan: cumulative target per week for one goal.
  function planSchedule(goal, now, weeks) {
    var need = weeklyNeed(goal, now);
    var n = weeks || 12;
    var rows = [];
    if (need.done) return rows;
    var perWeek = need.perWeek;
    if (perWeek == null) {
      // no deadline: spread remaining evenly across the planning horizon
      perWeek = round2(need.remaining / PLAN_HORIZON_WEEKS);
    }
    var start = toDateOnly(now || new Date()).getTime();
    for (var i = 0; i < n; i++) {
      var cumulative = Math.min(goal.target, round2(goal.saved + perWeek * (i + 1)));
      rows.push({
        weekIndex: i + 1,
        date: new Date(start + i * WEEK_MS).toISOString().slice(0, 10),
        deposit: round2(Math.min(perWeek, Math.max(0, goal.target - goal.saved - perWeek * i))),
        cumulativeTarget: cumulative,
        pct: goal.target > 0 ? clamp(cumulative / goal.target, 0, 1) : 0
      });
    }
    return rows;
  }

  /* ---------- milestones ---------- */

  function milestoneState(goal) {
    var p = progress(goal) * 100;
    return MILESTONES.map(function (m) {
      return { pct: m, reached: p >= m };
    });
  }

  /* ---------- dashboard summary ---------- */

  function summarize(goals, txMap, now) {
    var totalTarget = 0, totalSaved = 0, totalPerWeek = 0, active = 0, doneCount = 0;
    (goals || []).forEach(function (g) {
      totalTarget += g.target;
      totalSaved += g.saved;
      var need = weeklyNeed(g, now);
      if (need.done) doneCount++;
      else {
        active++;
        totalPerWeek += effectivePerWeek(g, now);
      }
    });
    return {
      totalTarget: round2(totalTarget),
      totalSaved: round2(totalSaved),
      overall: totalTarget > 0 ? clamp(totalSaved / totalTarget, 0, 1) : 0,
      perWeek: round2(totalPerWeek),
      active: active,
      done: doneCount
    };
  }

  /* ---------- state container ---------- */

  function emptyState() {
    return { version: 1, settings: { lang: 'ar', currency: 'EGP' }, goals: [], txs: [] };
  }

  function serialize(state) {
    return JSON.stringify(state, null, 2);
  }

  // Parse + validate an imported JSON payload. Throws on bad shape.
  function deserialize(json) {
    var data = JSON.parse(json);
    if (!data || typeof data !== 'object') throw new Error('bad payload');
    if (!Array.isArray(data.goals)) throw new Error('goals must be an array');
    var state = emptyState();
    if (data.settings && typeof data.settings === 'object') {
      if (data.settings.lang === 'ar' || data.settings.lang === 'en') state.settings.lang = data.settings.lang;
      if (typeof data.settings.currency === 'string') state.settings.currency = data.settings.currency.slice(0, 6);
    }
    data.goals.forEach(function (g) {
      if (!g || typeof g.name !== 'string' || !g.name.trim()) throw new Error('goal missing name');
      var target = Number(g.target);
      if (!isFinite(target) || target <= 0) throw new Error('goal target must be positive');
      state.goals.push({
        id: typeof g.id === 'string' && g.id ? g.id : uid('g'),
        name: g.name.trim().slice(0, 60),
        icon: typeof g.icon === 'string' && g.icon ? g.icon.slice(0, 8) : '🎯',
        target: round2(target),
        saved: round2(clamp(Number(g.saved) || 0, 0, target)),
        deadline: g.deadline ? String(g.deadline).slice(0, 10) : null,
        createdAt: g.createdAt ? String(g.createdAt) : new Date().toISOString()
      });
    });
    if (Array.isArray(data.txs)) {
      var known = {};
      state.goals.forEach(function (g) { known[g.id] = true; });
      data.txs.forEach(function (t) {
        if (!t || !known[t.goalId]) return;
        var amount = Number(t.amount);
        if (!isFinite(amount) || amount === 0) return;
        state.txs.push({
          id: typeof t.id === 'string' && t.id ? t.id : uid('t'),
          goalId: t.goalId,
          amount: round2(amount),
          date: /^\d{4}-\d{2}-\d{2}$/.test(t.date || '') ? t.date : todayISO(),
          note: typeof t.note === 'string' ? t.note.slice(0, 140) : ''
        });
      });
    }
    return state;
  }

  // Apply a transaction to a goal's saved amount (clamped 0..target).
  function applyTx(state, tx) {
    var goal = null;
    for (var i = 0; i < state.goals.length; i++) {
      if (state.goals[i].id === tx.goalId) { goal = state.goals[i]; break; }
    }
    if (!goal) throw new Error('unknown goal');
    goal.saved = round2(clamp(goal.saved + tx.amount, 0, goal.target));
    state.txs.push(tx);
    return goal;
  }

  return {
    WEEK_MS: WEEK_MS,
    STORAGE_KEY: STORAGE_KEY,
    PRESETS: PRESETS,
    MILESTONES: MILESTONES,
    uid: uid,
    round2: round2,
    clamp: clamp,
    todayISO: todayISO,
    PLAN_HORIZON_WEEKS: PLAN_HORIZON_WEEKS,
    effectivePerWeek: effectivePerWeek,
    makeGoal: makeGoal,
    makeTx: makeTx,
    progress: progress,
    weeklyNeed: weeklyNeed,
    avgWeeklyRate: avgWeeklyRate,
    projectedDate: projectedDate,
    paceStatus: paceStatus,
    planSchedule: planSchedule,
    milestoneState: milestoneState,
    summarize: summarize,
    emptyState: emptyState,
    serialize: serialize,
    deserialize: deserialize,
    applyTx: applyTx
  };
});
