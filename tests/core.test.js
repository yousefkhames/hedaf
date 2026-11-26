'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/core.js');

const NOW = new Date('2026-11-26T12:00:00');

function goal(over) {
  return Object.assign({
    id: 'g1', name: 'Phone', icon: '📱', target: 30000, saved: 6000,
    deadline: '2027-02-26', createdAt: '2026-10-01T00:00:00.000Z'
  }, over || {});
}

test('progress clamps between 0 and 1', () => {
  assert.equal(C.progress(goal({ target: 0, saved: 0 })), 0);
  assert.equal(C.progress(goal({ saved: 6000 })), 0.2);
  assert.equal(C.progress(goal({ saved: 99999 })), 1);
});

test('weeklyNeed splits the remainder over remaining weeks', () => {
  const need = C.weeklyNeed(goal(), NOW);
  assert.equal(need.remaining, 24000);
  // 2026-11-26 -> 2027-02-26 is 92 days => ceil(92/7) = 14 weeks
  assert.equal(need.weeksLeft, 14);
  assert.equal(need.perWeek, C.round2(24000 / 14));
  assert.equal(need.overdue, false);
});

test('weeklyNeed marks finished goals done', () => {
  const need = C.weeklyNeed(goal({ saved: 30000 }), NOW);
  assert.equal(need.done, true);
  assert.equal(need.perWeek, 0);
});

test('weeklyNeed without deadline returns null plan', () => {
  const need = C.weeklyNeed(goal({ deadline: null }), NOW);
  assert.equal(need.weeksLeft, null);
  assert.equal(need.perWeek, null);
  assert.equal(need.remaining, 24000);
});

test('weeklyNeed past deadline is overdue with the full remainder due', () => {
  const need = C.weeklyNeed(goal({ deadline: '2026-11-20' }), NOW);
  assert.equal(need.overdue, true);
  assert.equal(need.weeksLeft, 0);
  assert.equal(need.perWeek, 24000);
});

test('avgWeeklyRate averages positive flow over the window', () => {
  const txs = [
    C.makeTx('g1', 1000, '2026-11-24'),
    C.makeTx('g1', 500, '2026-11-10'),
    C.makeTx('g1', -200, '2026-11-12'),
    C.makeTx('g1', 5000, '2026-08-01') // outside window
  ];
  const rate = C.avgWeeklyRate(txs, NOW, 8);
  assert.equal(rate, C.round2(1300 / 8));
});

test('avgWeeklyRate returns 0 when nothing saved', () => {
  assert.equal(C.avgWeeklyRate([], NOW), 0);
  assert.equal(C.avgWeeklyRate([C.makeTx('g1', -100, '2026-11-20')], NOW), 0);
});

test('projectedDate projects from the recent pace', () => {
  const g = goal();
  const txs = [C.makeTx('g1', 8000, '2026-11-20')]; // 1000/week over 8 weeks
  const p = C.projectedDate(g, txs, NOW);
  assert.equal(p.rate, 1000);
  assert.equal(p.weeksNeeded, 24);
  assert.ok(p.date > '2027-04-01' && p.date < '2027-06-01');
});

test('projectedDate is null-dated with no pace', () => {
  const p = C.projectedDate(goal(), [], NOW);
  assert.equal(p.date, null);
  assert.equal(p.done, false);
});

test('paceStatus reads linear expectation', () => {
  // created 2026-10-01, deadline 2027-02-26: on 2026-11-26 ~37% elapsed
  assert.equal(C.paceStatus(goal({ saved: 0 }), NOW), 'behind');
  assert.equal(C.paceStatus(goal({ saved: 11000 }), NOW), 'on-track');
  assert.equal(C.paceStatus(goal({ saved: 20000 }), NOW), 'ahead');
  assert.equal(C.paceStatus(goal({ saved: 30000 }), NOW), 'done');
  assert.equal(C.paceStatus(goal({ deadline: null }), NOW), 'flexible');
  assert.equal(C.paceStatus(goal({ deadline: '2026-11-01' }), NOW), 'overdue');
});

test('planSchedule builds a capped cumulative schedule', () => {
  const g = goal({ target: 1000, saved: 200, deadline: '2026-12-24' }); // 4 weeks -> 200/wk
  const rows = C.planSchedule(g, NOW, 6);
  assert.equal(rows.length, 6);
  assert.equal(rows[0].deposit, 200);
  assert.equal(rows[3].cumulativeTarget, 1000);
  assert.equal(rows[4].deposit, 0); // goal already fully planned
  assert.equal(rows[5].pct, 1);
});

test('planSchedule without a deadline spreads over the horizon', () => {
  const rows = C.planSchedule(goal({ deadline: null }), NOW, 12);
  assert.equal(rows.length, 12);
  assert.equal(C.round2(rows[11].cumulativeTarget), 30000);
});

test('milestoneState flips pips at thresholds', () => {
  const ms = C.milestoneState(goal({ saved: 15000 })); // 50%
  assert.deepEqual(ms.map(m => m.reached), [true, true, false, false]);
});

test('summarize aggregates the dashboard numbers', () => {
  const goals = [
    goal(),
    goal({ id: 'g2', target: 10000, saved: 10000, deadline: null }),
    goal({ id: 'g3', target: 4000, saved: 0, deadline: null })
  ];
  const s = C.summarize(goals, null, NOW);
  assert.equal(s.totalTarget, 44000);
  assert.equal(s.totalSaved, 16000);
  assert.equal(s.done, 1);
  assert.equal(s.active, 2);
  // deadline goal: 24000/14; no-deadline goal: 4000/12 spread; done goal: 0
  assert.equal(s.perWeek, C.round2(24000 / 14) + C.round2(4000 / 12));
});

test('effectivePerWeek agrees with planSchedule for no-deadline goals', () => {
  const g = goal({ deadline: null });
  const perWeek = C.effectivePerWeek(g, NOW);
  const rows = C.planSchedule(g, NOW, 12);
  assert.equal(perWeek, rows[0].deposit);
  assert.equal(perWeek, C.round2(24000 / 12));
});

test('effectivePerWeek returns 0 for done goals and deadline need otherwise', () => {
  assert.equal(C.effectivePerWeek(goal({ saved: 30000 }), NOW), 0);
  assert.equal(C.effectivePerWeek(goal(), NOW), C.round2(24000 / 14));
});

test('serialize/deserialize round-trips state', () => {
  const st = C.emptyState();
  st.settings.lang = 'en';
  st.settings.currency = 'USD';
  const g = C.makeGoal({ name: 'Car', icon: '🚗', target: 500000, saved: 12000, deadline: '2028-01-01' }, NOW);
  st.goals.push(g);
  st.txs.push(C.makeTx(g.id, 12000, '2026-11-20', 'first'));
  const back = C.deserialize(C.serialize(st));
  assert.equal(back.settings.lang, 'en');
  assert.equal(back.goals.length, 1);
  assert.equal(back.goals[0].name, 'Car');
  assert.equal(back.txs.length, 1);
  assert.equal(back.txs[0].note, 'first');
});

test('deserialize rejects malformed payloads', () => {
  assert.throws(() => C.deserialize('{"goals":{}}'));
  assert.throws(() => C.deserialize('{"goals":[{"name":"","target":100}]}'));
  assert.throws(() => C.deserialize('{"goals":[{"name":"x","target":-5}]}'));
  assert.throws(() => C.deserialize('not json'));
});

test('deserialize drops orphan transactions and clamps saved', () => {
  const st = C.deserialize(JSON.stringify({
    goals: [{ id: 'g1', name: 'X', target: 100, saved: 500 }],
    txs: [
      { goalId: 'g1', amount: 20, date: '2026-11-01' },
      { goalId: 'ghost', amount: 20, date: '2026-11-01' },
      { goalId: 'g1', amount: 'nope' }
    ]
  }));
  assert.equal(st.goals[0].saved, 100);
  assert.equal(st.txs.length, 1);
});

test('applyTx clamps saved into [0, target]', () => {
  const st = C.emptyState();
  const g = C.makeGoal({ name: 'Hajj', target: 1000, saved: 900 }, NOW);
  st.goals.push(g);
  C.applyTx(st, C.makeTx(g.id, 500, '2026-11-26'));
  assert.equal(g.saved, 1000);
  C.applyTx(st, C.makeTx(g.id, -2000, '2026-11-26'));
  assert.equal(g.saved, 0);
});

test('applyTx throws on unknown goal', () => {
  const st = C.emptyState();
  assert.throws(() => C.applyTx(st, C.makeTx('nope', 10)));
});

test('makeGoal trims and sanitizes input', () => {
  const g = C.makeGoal({ name: '  عربية  ', target: '250000.456', saved: -10 }, NOW);
  assert.equal(g.name, 'عربية');
  assert.equal(g.target, 250000.46);
  assert.equal(g.saved, 0);
  assert.equal(g.icon, '🎯');
});

test('todayISO returns YYYY-MM-DD', () => {
  assert.match(C.todayISO(NOW), /^2026-11-26$/);
});
