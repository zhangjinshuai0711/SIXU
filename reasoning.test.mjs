import { test } from "node:test";
import assert from "node:assert/strict";
import { createReasoning } from "./reasoning.mjs";
import { gradeCase, schedulingOracle } from "./cases.mjs";

const plan = {
  kind: "plan", goal: "Compute a result", constraints: ["Respect the supplied arithmetic."],
  subproblems: [
    { id: "S1", question: "Compute the sum.", depends_on: [] },
    { id: "S2", question: "Double the sum.", depends_on: ["S1"] },
  ],
};
const solved = (id, result = "Intermediate result.") => ({ kind: "solve", subproblem_id: id, result, evidence: [] });
const review = (issues = []) => ({ kind: "review", checks: [{ constraint_index: 0, finding: "Checked against the task." }], issues });
const final = (result, values) => ({
  kind: "final", answer: "Synthesized answer.", covered_constraint_indices: [0],
  conclusions: conclusions(values), unresolved: [], ...(result ? { result } : {}),
});
function send(controller, state, artifact) {
  return controller.submit({ run_id: state.run_id, stage_key: state.stage_key, artifact });
}
function toFinal(controller, state) {
  state = send(controller, state, plan);
  state = send(controller, state, solved("S1"));
  state = send(controller, state, solved("S2"));
  return send(controller, state, review());
}

const conclusions = (values = ["Intermediate result.", "Intermediate result."]) =>
  values.map((result, i) => ({
    subproblem_id: `S${i + 1}`, disposition: "confirmed", result,
    basis: "Rechecked against the task and the final answer.",
  }));

test("final submission must reconcile every subproblem exactly once", () => {
  const controller = createReasoning();
  const state = toFinal(controller, controller.start({ task: "Compute a result." }));
  const missing = final();
  delete missing.conclusions;
  assert.equal(send(controller, state, missing).status, "rejected");
  assert.equal(send(controller, state, { ...final(), conclusions: conclusions().slice(0, 1) }).status, "rejected");
  assert.equal(send(controller, state, {
    ...final(), conclusions: [conclusions()[0], conclusions()[0]],
  }).status, "rejected");
  assert.equal(send(controller, state, {
    ...final(), conclusions: [conclusions()[0], { ...conclusions()[1], subproblem_id: "S3" }],
  }).status, "rejected");
  assert.equal(send(controller, state, { ...final(), conclusions: conclusions() }).status, "completed");
});

test("final revisions replace stale results and preserve the prior result in the audit", () => {
  const events = [];
  const controller = createReasoning({ onEvent: event => events.push(event) });
  const state = toFinal(controller, controller.start({ task: "Compute a result." }));
  const reconciled = conclusions(["19", "38"]).map(item => ({ ...item, disposition: "revised" }));
  const done = send(controller, state, { ...final(), answer: "38", conclusions: reconciled });
  assert.equal(done.status, "completed");
  assert.deepEqual(done.canonical_findings, reconciled);
  assert.deepEqual(done.unresolved_subproblems, []);
  const audit = events.find(event => event.event === "reasoning_reconciled");
  assert.equal(audit.previous_results.S1.result, "Intermediate result.");
  assert.equal(audit.stored_results.S1.result, "19");
  assert.equal(audit.stored_results.S2.result, "38");
  assert.deepEqual(controller.status(state.run_id).canonical_findings, reconciled);
});

test("confirmed conclusions cannot silently change a stored result", () => {
  const controller = createReasoning();
  const state = toFinal(controller, controller.start({ task: "Compute a result." }));
  const rejected = send(controller, state, { ...final(), conclusions: conclusions(["19", "38"]) });
  assert.equal(rejected.status, "rejected");
  assert.equal(controller.status(state.run_id).stored_results.S1.result, "Intermediate result.");
});

test("unresolved final conclusions cannot be hidden by an empty unresolved list", () => {
  const controller = createReasoning();
  const state = toFinal(controller, controller.start({ task: "Compute a result." }));
  const items = conclusions();
  items[1] = { ...items[1], disposition: "unresolved", basis: "Missing evidence." };
  assert.equal(send(controller, state, { ...final(), conclusions: items }).status, "rejected");
  const done = send(controller, state, {
    ...final(), conclusions: items, unresolved: ["S2 lacks supporting evidence."],
  });
  assert.equal(done.status, "completed");
  assert.deepEqual(done.unresolved_subproblems, ["S2"]);
});

test("stage order, stale submissions and dependency validation are enforced", () => {
  const controller = createReasoning();
  const start = controller.start({ task: "Compute (12+7)*2." });
  assert.equal(send(controller, start, final()).status, "rejected");
  const bad = structuredClone(plan);
  bad.subproblems[0].depends_on = ["S2"];
  assert.equal(send(controller, start, bad).status, "rejected");
  const next = send(controller, start, plan);
  assert.equal(send(controller, start, plan).status, "rejected");
  assert.equal(send(controller, next, solved("S2")).status, "rejected");
  assert.equal(controller.status(start.run_id).phase, "solve");
});

test("general workflow completes without claiming semantic verification", () => {
  const events = [];
  const controller = createReasoning({ onEvent: event => events.push(event) });
  const state = toFinal(controller, controller.start({ task: "Compute (12+7)*2." }));
  assert.equal(send(controller, state, { ...final(), covered_constraint_indices: [1] }).status, "rejected");
  const done = send(controller, state, final());
  assert.equal(done.status, "completed");
  assert.match(done.verification, /semantic correctness remains unverified/);
  assert.ok(events.some(event => event.event === "reasoning_completed"));
});

test("repairing a parent also schedules its dependent results for recomputation", () => {
  const controller = createReasoning();
  let state = controller.start({ task: "Compute (12+7)*2." });
  state = send(controller, state, plan);
  state = send(controller, state, solved("S1"));
  state = send(controller, state, solved("S2"));
  state = send(controller, state, review([{ subproblem_id: "S1", problem: "Sum incorrect.", basis: "Arithmetic check." }]));
  assert.deepEqual(state.results_requiring_recompute, ["S1", "S2"]);
  state = send(controller, state, solved("S1", "19"));
  assert.equal(state.current_subproblem.id, "S2");
  state = send(controller, state, solved("S2", "38"));
  state = send(controller, state, review());
  assert.equal(send(controller, state, final(undefined, ["19", "38"])).status, "completed");
});

test("repeated review issues stop repairing and must remain visible in the final answer", () => {
  const controller = createReasoning();
  let state = controller.start({ task: "Compute a result." });
  state = send(controller, state, plan);
  state = send(controller, state, solved("S1"));
  state = send(controller, state, solved("S2"));
  const issue = [{ subproblem_id: "S2", problem: "Unverified.", basis: "Missing evidence." }];
  state = send(controller, state, review(issue));
  state = send(controller, state, solved("S2"));
  state = send(controller, state, review(issue));
  assert.equal(state.phase, "synthesize");
  assert.equal(send(controller, state, final()).status, "rejected");
  assert.equal(send(controller, state, { ...final(), unresolved: ["S2 remains unverified."] }).status, "rejected");
  const items = conclusions();
  items[1].disposition = "unresolved";
  assert.equal(send(controller, state, {
    ...final(), conclusions: items, unresolved: ["S2 remains unverified."],
  }).status, "completed");
});

test("fixed-case checker and oracle handle maintenance and objective constraints", () => {
  const oracle = schedulingOracle();
  assert.equal(gradeCase("sched-01", oracle).passed, true);
  const impossible = { starts: { A: 0, B: 3, C: 3, D: 7, E: 10, F: 12 }, makespan: 13 };
  assert.equal(gradeCase("sched-01", impossible).passed, false);
  const delayed = { starts: Object.fromEntries(Object.entries(oracle.starts).map(([id, start]) => [id, start + 24])), makespan: oracle.makespan + 24 };
  assert.equal(gradeCase("sched-01", delayed).passed, false);
  // An independent exhaustive infeasibility check is covered by the oracle;
  // this fixed certificate also checks its optimum against a hand-derived bound.
  assert.equal(oracle.makespan, 14);
});

test("no-feedback comparison records objective errors without giving answer feedback", () => {
  const events = [];
  const controller = createReasoning({ onEvent: event => events.push(event) });
  const state = toFinal(controller, controller.start({ case_id: "sched-01", feedback: "none" }));
  const done = send(controller, state, final({ starts: {}, makespan: 0 }));
  assert.equal(done.status, "completed");
  assert.match(done.verification, /withheld/);
  assert.equal(events.find(event => event.event === "reasoning_final").objective_grade.passed, false);
  assert.equal("objective_grade" in controller.status(state.run_id), false);
});

test("objective feedback is bounded and cannot silently pass a wrong answer", () => {
  const controller = createReasoning();
  const state = toFinal(controller, controller.start({ case_id: "sched-01", feedback: "objective" }));
  assert.equal(send(controller, state, final({ starts: {}, makespan: 0 })).status, "rejected");
  const done = send(controller, state, final({ starts: {}, makespan: 0 }));
  assert.equal(done.status, "stopped");
  assert.equal(done.verification.passed, false);
});

test("total submission budget terminates repeated invalid submissions", () => {
  const controller = createReasoning();
  const state = controller.start({ task: "Compute." });
  for (let i = 0; i < 18; i++) assert.equal(send(controller, state, final()).status, "rejected");
  assert.equal(send(controller, state, final()).status, "stopped");
});
