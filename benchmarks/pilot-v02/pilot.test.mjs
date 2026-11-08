import { test } from "node:test";
import assert from "node:assert/strict";
import { cases } from "./cases.mjs";
import { grade, oracle } from "./pilot.mjs";

test("Python graders match independently traced alias and closure outputs", () => {
  assert.deepEqual(oracle(cases[0]), {
    out: [[6], [6, 3], [6, 3, 8, 1], [6, 3, 8, 1, -1]],
    snapshot: [6, 3], a: { items: [6, 3, 8, 1, -1] },
    b: { items: [6, 3, 8, 1, 9] }, same: false,
  });
  assert.deepEqual(oracle(cases[1]), {
    out: [1, 2, 2, 1], snapshot: [2, 0], first: 2, rest: [7, 1],
    rows: { a: [0, 7, 1, 0], b: [5] }, same: false,
  });
});

// This time-stepped state search is independent of the oracle's start-time recursion.
function timeSearch(c) {
  const tasks = c.tasks;
  let layer = [{ started: 0, remaining: tasks.map(() => 0) }];
  const upper = c.tasks.reduce((s, t) => s + t.duration, 0) +
    Math.max(...c.maintenance.map(m => m.to), ...tasks.map(t => t.release));
  for (let time = 0; time <= upper; time++) {
    const next = new Map();
    for (const state of layer) {
      if (state.started === (1 << tasks.length) - 1 && state.remaining.every(x => x === 0)) return time;
      const available = c.maintenance.find(m => m.from <= time && time < m.to)?.capacity ?? c.capacity;
      const load = tasks.reduce((s, t, i) => s + (state.remaining[i] > 0 ? t.workers : 0), 0);
      if (load > available) continue;
      const ready = tasks.map((t, i) => i).filter(i => !(state.started & (1 << i)) &&
        tasks[i].release <= time && tasks[i].after.every(id => {
          const p = tasks.findIndex(t => t.id === id);
          return (state.started & (1 << p)) && state.remaining[p] === 0;
        }));
      for (let subset = 0; subset < 1 << ready.length; subset++) {
        const chosen = ready.filter((_, i) => subset & (1 << i));
        if (load + chosen.reduce((s, i) => s + tasks[i].workers, 0) > available) continue;
        const started = chosen.reduce((bits, i) => bits | (1 << i), state.started);
        const remaining = state.remaining.map((r, i) => Math.max(0, (chosen.includes(i) ? tasks[i].duration : r) - 1));
        next.set(`${started}:${remaining.join(",")}`, { started, remaining });
      }
    }
    layer = [...next.values()];
  }
  throw new Error("Independent search found no solution.");
}
for (const c of cases.filter(c => c.type === "schedule")) {
  test(`${c.id}: independent time search agrees and infeasible/suboptimal answers fail`, () => {
    const best = oracle(c);
    assert.equal(timeSearch(c), best.makespan);
    assert.equal(grade(c, best).passed, true);
    const delayed = { starts: Object.fromEntries(Object.entries(best.starts).map(([id, s]) => [id, s + 100])),
      makespan: best.makespan + 100 };
    assert.equal(grade(c, delayed).constraints_passed, true);
    assert.equal(grade(c, delayed).passed, false);
    assert.equal(grade(c, { starts: Object.fromEntries(c.tasks.map(t => [t.id, 0])), makespan: 1 }).passed, false);
  });
}
test("selection and assignment graders reject invalid constraints and inconsistent totals", () => {
  for (const c of cases.filter(c => c.type === "selection" || c.type === "assignment")) {
    const best = oracle(c);
    assert.equal(grade(c, best).passed, true);
    assert.equal(grade(c, null).passed, false);
    const changed = c.type === "selection" ? { ...best, cost: best.cost + 1 } : { ...best, total_cost: best.total_cost + 1 };
    assert.equal(grade(c, changed).passed, false);
  }
  const selection = cases.find(c => c.type === "selection");
  assert.equal(grade(selection, { selected: ["G"], cost: 3, value: 9 }).constraints_passed, false);
  const assignment = cases.find(c => c.type === "assignment");
  assert.equal(grade(assignment, { assignment: Object.fromEntries(cases[5].costs.map((_, i) => [`P${i + 1}`, 1])),
    total_cost: 0 }).constraints_passed, false);
});
