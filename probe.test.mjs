import { test } from "node:test";
import assert from "node:assert/strict";
import { createProbe, findOptimum } from "./probe.mjs";

test("verifier rejects overload and suboptimal schedules without advancing", () => {
  const probe = createProbe();
  const stage = probe.start("unit-test");
  const submit = candidate => probe.submit({ ...stage, ...candidate });
  assert.equal(submit({ starts: { A: 0, B: 0, C: 2, D: 4 }, makespan: 5 }).status, "rejected");
  assert.equal(submit({ starts: { A: 0, B: 4, C: 2, D: 7 }, makespan: 8 }).status, "rejected");
  assert.equal(probe.status(stage.run_id).completed_phases, 0);
  assert.equal(findOptimum(0), 6);
});

test("new constraint is enforced and stale submissions cannot advance a phase", () => {
  const probe = createProbe();
  const first = probe.start("unit-test");
  const original = { starts: { A: 0, B: 2, C: 2, D: 5 }, makespan: 6 };
  const second = probe.submit({ ...first, ...original });
  assert.equal(second.status, "accepted");
  assert.equal(probe.submit({ ...first, ...original }).status, "stale_stage");
  assert.equal(probe.submit({ ...second, ...original }).status, "rejected");
  const b = second.earliest_start_B;
  const done = probe.submit({
    ...second, starts: { A: 0, B: b, C: 2, D: b + 3 }, makespan: b + 4,
  });
  assert.equal(done.status, "completed");
  assert.equal(probe.status(first.run_id).completed_phases, 2);
});

test("separate runs do not share phase keys and expired runs cannot be resumed", () => {
  const probe = createProbe();
  const one = probe.start();
  const two = probe.start();
  assert.equal(probe.submit({
    run_id: one.run_id, stage_key: two.stage_key,
    starts: { A: 0, B: 2, C: 2, D: 5 }, makespan: 6,
  }).status, "stale_stage");
  const expired = createProbe({ ttlMs: -1 });
  const run = expired.start();
  assert.throws(() => expired.status(run.run_id), /expired/);
});
