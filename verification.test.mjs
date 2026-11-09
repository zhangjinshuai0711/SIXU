import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSchema, validateDefinitions, validateJson, runChecks } from "./verification.mjs";

const requirement = { id: "R1", quote: "Check these values.", method: "internal" };
function check(data, result) {
  const definition = checkSchema.parse({ id: "T1", requirement_id: "R1", ...data });
  validateDefinitions(requirement.quote, [requirement], [definition]);
  return runChecks([definition], { id: "C1", version: 1, result })[0];
}
const arithmetic = { type: "arithmetic", left: { path: ["total"] }, right: 4, relation: "eq" };

test("arithmetic checks expressions, bounds, floating tolerance and exact failure locations", () => {
  assert.equal(check(arithmetic, { total: 4 }).passed, true);
  assert.equal(check(arithmetic, { total: 5 }).passed, false);
  assert.equal(check({ ...arithmetic, relation: "le" }, { total: 3 }).passed, true);
  assert.equal(check({ ...arithmetic, relation: "ge" }, { total: 5 }).passed, true);
  assert.equal(check({ ...arithmetic, left: { op: "add", left: 0.1, right: 0.2 }, right: 0.3 }, {}).passed, true);
  const result = check({ ...arithmetic, left: { op: "divide", left: 1, right: 0 } }, {});
  assert.equal(result.passed, false);
  assert.match(result.errors[0].message, /zero/);
  assert.equal(check(arithmetic, {}).passed, false);
  assert.equal(check(arithmetic, undefined).passed, false);
});

test("arithmetic rejects oversized expressions, nonfinite definitions and overflow", () => {
  let nested = 1;
  for (let count = 0; count < 9; count++) nested = { op: "add", left: nested, right: 1 };
  assert.throws(() => check({ ...arithmetic, left: nested }, {}), /depth/);
  assert.throws(() => check({ ...arithmetic, right: Infinity }, {}));
  assert.equal(check({ ...arithmetic, left: { op: "multiply", left: 1e308, right: 1e308 } }, {}).passed, false);
});

test("structure enforces required fields, types, ranges and structural uniqueness", () => {
  const fields = [
    { path: ["count"], type: "integer", min: 0, max: 3 },
    { path: ["items"], type: "array", unique: true },
    { path: ["optional"], type: "string", required: false },
  ];
  assert.equal(check({ type: "structure", fields }, { count: 2, items: [{ id: 1 }, { id: 2 }] }).passed, true);
  const failed = check({ type: "structure", fields }, { count: 4, items: [{ id: 1 }, { id: 1 }] });
  assert.equal(failed.errors.length, 2);
  assert.deepEqual(failed.errors[0].path, ["count"]);
  assert.equal(check({ type: "structure", fields }, { count: "2" }).passed, false);
});

const selection = {
  type: "selection", path: ["selected"], unit: "credits",
  items: [{ id: "A", cost: 4, value: 8 }, { id: "B", cost: 3, value: 7 }, { id: "C", cost: 5, value: 12 }],
  budget: 9, requires: [["C", "A"]], excludes: [["B", "C"]], cost_path: ["cost"], value_path: ["value"],
};
test("selection checks budget, dependencies, exclusions, IDs and declared totals without an optimum claim", () => {
  assert.equal(check(selection, { selected: ["A", "C"], cost: 9, value: 20 }).passed, true);
  assert.equal(check(selection, { selected: ["A"], cost: 4, value: 8 }).passed, true);
  for (const result of [
    { selected: ["C"], cost: 5, value: 12 }, { selected: ["A", "B", "C"], cost: 12, value: 27 },
    { selected: ["A", "A"], cost: 8, value: 16 }, { selected: ["D"], cost: 0, value: 0 },
    { selected: ["A"], cost: 5, value: 8 },
  ]) assert.equal(check(selection, result).passed, false);
});
const schedule = {
  type: "schedule", path: ["starts"], unit: "minutes", capacity: 1,
  tasks: [{ id: "A", duration: 2 }, { id: "B", duration: 2, after: ["A"] }],
  maintenance: [{ from: 4, to: 6, capacity: 0 }], makespan_path: ["makespan"],
};
test("schedule respects half-open boundaries, release, precedence, maintenance and totals", () => {
  assert.equal(check(schedule, { starts: { A: 0, B: 2 }, makespan: 4 }).passed, true);
  assert.equal(check(schedule, { starts: { A: 0, B: 6 }, makespan: 8 }).passed, true);
  for (const result of [
    { starts: { A: 0, B: 1 }, makespan: 3 }, { starts: { A: 0, B: 4 }, makespan: 6 },
    { starts: { A: -1, B: 2 }, makespan: 4 }, { starts: { A: 0 }, makespan: 4 },
    { starts: { A: 0, B: 2 }, makespan: 5 },
  ]) assert.equal(check(schedule, result).passed, false);
});
test("overlapping capacity windows use the most restrictive capacity and unsafe totals fail", () => {
  assert.equal(check({ ...schedule, maintenance: [{ from: 0, to: 2, capacity: 1 }, { from: 1, to: 2, capacity: 0 }] },
    { starts: { A: 0, B: 2 }, makespan: 4 }).passed, false);
  assert.equal(check(selection, { selected: ["A"], cost: 4.1, value: 8 }).passed, false);
});
test("definitions are sourced, bounded and referentially valid; arbitrary JSON cannot bypass limits", () => {
  const definition = checkSchema.parse({ id: "T1", requirement_id: "R1", ...selection });
  assert.throws(() => validateDefinitions("Different question.", [requirement], [definition]), /quote/);
  assert.throws(() => validateDefinitions(requirement.quote, [requirement], [definition, definition]), /unique/);
  assert.throws(() => check({ ...selection, requires: [["A", "D"]] }, {}), /Unknown/);
  assert.throws(() => check({ ...schedule, tasks: Array(65).fill({ id: "A", duration: 1 }) }, {}));
  assert.throws(() => validateJson(Array(65).fill(1)), /64/);
  assert.throws(() => validateJson(JSON.parse('{"__proto__":{}}')), /Unsafe/);
  assert.throws(() => validateJson({ total: NaN }));
});
