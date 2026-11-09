import { test } from "node:test";
import assert from "node:assert/strict";
import { createAdaptiveEngine } from "./adaptive-core.mjs";
import { randomUUID } from "node:crypto";

function fixture() {
  const records = new Map();
  return createAdaptiveEngine({ store: {
    owns: id => records.has(id), load: id => structuredClone(records.get(id)),
    save: run => records.set(run.id, structuredClone(run)),
  } });
}
const step = (action, extra = {}) => ({
  kind: "adaptive_step", action, summary: "Concrete finding.", rationale: "Targeted next step.", progress: true, ...extra,
});
const send = (engine, state, artifact) => engine.submit({ run_id: state.run_id, stage_key: state.stage_key, artifact });

test("v0.4 rejects final answer drift and requires review of the selected version", () => {
  const engine = fixture();
  let state = engine.start({ task: "Calculate 2+2." });
  state = send(engine, state, step("EXPAND", {
    candidate: { id: "C1", strategy: "addition", answer: "4" }, proposed_action: "FINALIZE",
  }));
  assert.equal(state.action, "CHALLENGE");
  state = send(engine, state, step("CHALLENGE", {
    review: { candidate_id: "C1", candidate_version: 1, finding: "2+2 agrees with 4." },
    proposed_action: "FINALIZE",
  }));
  assert.equal(state.action, "FINALIZE");
  const wrong = send(engine, state, {
    kind: "adaptive_final", selected_candidate_id: "C1", selected_candidate_version: 1, answer: "5", unresolved: [],
  });
  assert.equal(wrong.status, "rejected");
  state = send(engine, state, {
    kind: "adaptive_final", selected_candidate_id: "C1", selected_candidate_version: 1, unresolved: [],
  });
  assert.equal(state.final.answer, "4");
});

test("v0.4 reopens resolved model checks after any candidate replacement", () => {
  const engine = fixture();
  let state = engine.start({ task: "Total 90 minutes and include owners." });
  state = send(engine, state, step("EXPAND", {
    candidate: { id: "C1", strategy: "agenda", answer: "90 minutes, no owners." },
    issue: { candidate_id: "C1", state: "testable", description: "Check duration." },
  }));
  state = send(engine, state, step("VERIFY", {
    review: { candidate_id: "C1", candidate_version: 1, finding: "Total is 90." }, resolve_issue: 1,
    issue: { candidate_id: "C1", state: "error", description: "Owners missing." },
  }));
  state = send(engine, state, step("REVISE", {
    candidate: { id: "C1", strategy: "agenda", answer: "100 minutes, with owners." },
    resolve_issue: 2, proposed_action: "FINALIZE",
  }));
  state = engine.status(state.run_id, { detail: "full" });
  assert.equal(state.issues.find(issue => issue.id === 1).resolved, false);
  assert.equal(state.issues.find(issue => issue.id === 2).resolved, false);
  assert.equal(state.evidence[0].superseded, true);
  assert.notEqual(state.action, "FINALIZE");
});

const arithmeticTask = {
  task: "Calculate 2+2 and provide total.",
  requirements: [{ id: "R1", quote: "Calculate 2+2", method: "internal" }],
  checks: [{ id: "T1", requirement_id: "R1", type: "arithmetic",
    left: { op: "add", left: 2, right: 2 }, right: { path: ["total"] } }],
};
const makeCandidate = (answer = "4") => ({ id: "C1", strategy: "arithmetic", answer, result: { total: Number(answer) } });
const makeReview = (candidateId = "C1", candidateVersion = 1, extra = {}) => ({
  candidate_id: candidateId, candidate_version: candidateVersion, finding: "Checked the original requirements.", ...extra,
});
test("summary-only challenges identify the missing version-bound review and recover without weakening gates", () => {
  const engine = fixture();
  let state = engine.start({ task: "Calculate 2+2." });
  state = send(engine, state, step("EXPAND", { candidate: makeCandidate(), proposed_action: "FINALIZE" }));
  state = send(engine, state, step("CHALLENGE", {
    summary: "Reviewed C1: 2+2=4.", proposed_action: "FINALIZE",
  }));
  assert.equal(state.status, "searching");
  assert.equal(state.action, "CHALLENGE");
  assert.deepEqual(state.completion_blockers, ["Selected version needs a targeted model review."]);
  assert.match(state.next_action, /proposed_action=FINALIZE/);
  const rejected = send(engine, state, { kind: "adaptive_final", selected_candidate_id: "C1", selected_candidate_version: 1 });
  assert.equal(rejected.status, "rejected");
  assert.deepEqual(rejected.completion_blockers, state.completion_blockers);
  state = send(engine, state, step("CHALLENGE", {
    review: makeReview(), finalize: { selected_candidate_id: "C1", selected_candidate_version: 1 },
  }));
  assert.equal(state.status, "completed");
  assert.equal(state.action, "FINALIZE");
  assert.equal(state.action_reason, "ready");
  assert.equal(Object.hasOwn(state, "completion_blockers"), false);
  assert.equal(engine.status(state.run_id).final.answer, "4");
});

test("service failures schedule repair, cannot be self-cleared, and passing revision still needs review", () => {
  const engine = fixture();
  let state = engine.start(arithmeticTask);
  state = send(engine, state, step("EXPAND", { candidate: makeCandidate("5"), proposed_action: "FINALIZE" }));
  assert.equal(state.action, "REVISE");
  assert.equal(state.verification.results[0].verification, "service_executed");
  const rejected = send(engine, state, step("REVISE", {
    candidate: makeCandidate("4"), evidence: {
      candidate_id: "C1", candidate_version: 1, type: "model_review", description: "Old review.",
    },
  }));
  assert.equal(rejected.status, "rejected");
  assert.equal(engine.status(state.run_id).current_candidate.version, 1);
  state = send(engine, state, step("REVISE", { candidate: makeCandidate("4"), proposed_action: "FINALIZE" }));
  assert.equal(state.current_candidate.version, 2);
  assert.equal(state.verification.results[0].passed, true);
  assert.equal(state.action, "CHALLENGE");
  state = send(engine, state, step("CHALLENGE", {
    review: makeReview("C1", 2), finalize: { selected_candidate_id: "C1", selected_candidate_version: 2 },
  }));
  assert.equal(state.status, "completed");
  assert.deepEqual(state.final.result, { total: 4 });
});
test("deep mode requires real comparison and combined review completion saves the final round trip", () => {
  const engine = fixture();
  let state = engine.start({ task: "Compare strategies.", depth: "deep" });
  assert.equal(state.budget.max_steps, 12);
  state = send(engine, state, step("EXPAND", { candidate: makeCandidate(), proposed_action: "FINALIZE" }));
  assert.equal(state.action, "BRANCH");
  state = send(engine, state, step("BRANCH", { candidate: { id: "C2", strategy: "different", answer: "4" } }));
  state = send(engine, state, step("CHALLENGE", {
    review: makeReview("C1"), finalize: { selected_candidate_id: "C1", selected_candidate_version: 1 },
  }));
  assert.equal(state.status, "searching");
  assert.match(state.completion_blockers.join(" "), /comparison/);
  state = send(engine, state, step("CHALLENGE", {
    review: makeReview("C1", 1, { compared_candidate_ids: ["C1", "C2"] }),
    finalize: { selected_candidate_id: "C1", selected_candidate_version: 1 },
  }));
  assert.equal(state.status, "completed");
  assert.equal(state.budget.used_steps, 4);
  assert.equal(Object.hasOwn(state, "completion_blockers"), false);
});
test("persistent service errors upgrade medium once without resetting counters or custom hard limits", () => {
  const engine = fixture();
  let state = engine.start({ ...arithmeticTask, budget: { max_steps: 2, max_candidates: 1 } });
  state = send(engine, state, step("EXPAND", { candidate: makeCandidate("5") }));
  state = send(engine, state, step("REVISE", { candidate: makeCandidate("6") }));
  assert.equal(state.depth.actual, "deep");
  assert.equal(state.budget.used_steps, 2);
  assert.equal(state.budget.revisions_used, 1);
  assert.equal(state.budget.max_steps, 2);
  assert.equal(state.budget.max_candidates, 1);
  assert.equal(state.action_reason, "step_budget_exhausted");
  state = send(engine, state, { kind: "adaptive_final", selected_candidate_id: "C1", selected_candidate_version: 2 });
  assert.equal(state.status, "completed");
  assert.equal(state.final.verification_status, "incomplete");
  assert.ok(state.final.unresolved.length);
});
test("upgrade can be disabled and ordinary self-reported progress cannot extend a loop", () => {
  const engine = fixture();
  let state = engine.start({ ...arithmeticTask, auto_upgrade: false });
  state = send(engine, state, step("EXPAND", { candidate: makeCandidate("5") }));
  state = send(engine, state, step("REVISE", { candidate: makeCandidate("6") }));
  assert.equal(state.depth.actual, "medium");
  state = send(engine, state, step("REVISE", { candidate: makeCandidate("7") }));
  assert.equal(state.action_reason, "revision_budget_exhausted");
  let empty = engine.start({ task: "No candidate." });
  empty = send(engine, empty, step("EXPAND", { progress: true }));
  empty = send(engine, empty, step("EXPAND", { progress: true }));
  assert.equal(empty.action_reason, "no_progress_limit");
  empty = send(engine, empty, { kind: "adaptive_final" });
  assert.equal(empty.final.verification_status, "incomplete");
});
test("definitions cannot be replaced or weakened; sourced additions execute and survive compact responses", () => {
  const engine = fixture();
  let state = engine.start(arithmeticTask);
  state = send(engine, state, step("EXPAND", { candidate: makeCandidate() }));
  assert.equal(Object.hasOwn(state, "task"), false);
  assert.equal(Object.hasOwn(state, "history"), false);
  const rejected = send(engine, state, step("CHALLENGE", { add_checks: [{ ...arithmeticTask.checks[0], right: 5 }] }));
  assert.equal(rejected.status, "rejected");
  assert.deepEqual(engine.status(state.run_id).checks[0].left, { op: "add", left: 2, right: 2 });
  assert.deepEqual(engine.status(state.run_id).checks[0].right, { path: ["total"] });
  state = send(engine, state, step("CHALLENGE", {
    add_requirements: [{ id: "R2", quote: "provide total", method: "internal" }],
    add_checks: [{ id: "T2", requirement_id: "R2", type: "structure", fields: [{ path: ["total"], type: "number" }] }],
    review: makeReview(),
  }));
  assert.equal(state.verification.results.length, 2);
  assert.ok(engine.status(state.run_id, { detail: "full" }).history.length);
});
test("duplicate reviews are not new progress and unselected candidates do not block a valid final", () => {
  const engine = fixture();
  let state = engine.start({ task: "Compare two alternatives." });
  state = send(engine, state, step("EXPAND", {
    candidate: makeCandidate(), issue: { candidate_id: "C1", state: "stuck", description: "Bad strategy." },
  }));
  state = send(engine, state, step("BRANCH", { candidate: { id: "C2", strategy: "working", answer: "4" } }));
  state = send(engine, state, step("CHALLENGE", { review: makeReview("C2"), proposed_action: "CHALLENGE" }));
  state = send(engine, state, step("CHALLENGE", { review: makeReview("C2"), progress: true, proposed_action: "CHALLENGE" }));
  assert.equal(state.budget.consecutive_no_progress, 1);
  state = send(engine, state, step("CHALLENGE", {
    review: makeReview("C2"), finalize: { selected_candidate_id: "C2", selected_candidate_version: 1 },
  }));
  assert.equal(state.final.unresolved.length, 0);
  assert.ok(state.final.discarded_candidates[0].remaining_issues.length);
});
test("legacy adaptive state is readable but rejected submissions never mutate it", () => {
  const records = new Map();
  const runId = randomUUID();
  const legacy = { id: runId, stageKey: randomUUID(), task: "Legacy.", createdAt: Date.now(),
    history: [{ summary: "Old finding." }], candidates: [{ id: "C1", answer: "Old." }] };
  records.set(runId, legacy);
  const engine = createAdaptiveEngine({ store: { owns: id => records.has(id), load: id => records.get(id), save: run => records.set(run.id, run) } });
  assert.equal(engine.status(runId).legacy_read_only, true);
  assert.equal(send(engine, engine.status(runId), step("EXPAND")).status, "rejected");
  assert.deepEqual(records.get(runId), legacy);
});
test("model-only requirements require explicit coverage, stale reviews and forged service results fail", () => {
  const engine = fixture();
  let state = engine.start({ task: "Explain risks.", requirements: [{ id: "R1", quote: "risks", method: "model" }] });
  state = send(engine, state, step("EXPAND", { candidate: makeCandidate() }));
  assert.equal(send(engine, state, step("CHALLENGE", { review: makeReview("C1", 2) })).status, "rejected");
  assert.equal(send(engine, state, step("CHALLENGE", {
    evidence: { candidate_id: "C1", candidate_version: 1, description: "Pass.", type: "service_executed" },
  })).status, "rejected");
  state = send(engine, state, step("CHALLENGE", { review: makeReview(), proposed_action: "FINALIZE" }));
  assert.equal(state.action, "CHALLENGE");
  state = send(engine, state, step("CHALLENGE", {
    review: makeReview("C1", 1, { requirement_ids: ["R1"] }),
    finalize: { selected_candidate_id: "C1", selected_candidate_version: 1 },
  }));
  assert.equal(state.status, "completed");
});

test("accepted response byte metrics match the actual serialized payload and queries do not mutate them", () => {
  const engine = fixture();
  let state = engine.start({ task: "Count bytes." });
  assert.equal(state.response_bytes, Buffer.byteLength(JSON.stringify(state)));
  const beginBytes = state.response_bytes;
  state = send(engine, state, step("EXPAND", { candidate: makeCandidate() }));
  assert.equal(state.response_bytes, Buffer.byteLength(JSON.stringify(state)));
  assert.equal(state.metrics.returned_bytes, beginBytes + state.response_bytes);
  assert.deepEqual(engine.status(state.run_id).metrics, state.metrics);
});

test("legacy v0.3 connector payloads can infer deep mode, review via model_review evidence, and finalize without version fields", () => {
  const engine = fixture();
  let state = engine.start({ task: "深度分析：计算 2+2，用两种方法比较。" });
  assert.equal(state.depth.requested, "deep");
  assert.equal(state.depth.actual, "deep");
  state = send(engine, state, step("EXPAND", {
    candidate: { id: "C1", strategy: "addition", answer: "4" },
  }));
  assert.equal(state.action, "BRANCH");
  state = send(engine, state, step("BRANCH", {
    candidate: { id: "C2", strategy: "counting", answer: "4" },
  }));
  assert.equal(state.action, "CHALLENGE");
  state = send(engine, state, step("CHALLENGE", {
    evidence: { candidate_id: "C1", type: "model_review", description: "Compared C1 and C2; both yield 4." },
    proposed_action: "FINALIZE",
  }));
  assert.equal(state.action, "FINALIZE");
  state = send(engine, state, {
    kind: "adaptive_final", selected_candidate_id: "C1", answer: "4", unresolved: [],
  });
  assert.equal(state.status, "completed");
  assert.equal(state.final.answer, "4");
  assert.equal(state.final.selected_candidate_version, 1);
});

test("deep review counts its target and one other candidate after revision and persisted recovery", () => {
  const records = new Map();
  const store = {
    owns: id => records.has(id), load: id => structuredClone(records.get(id)),
    save: run => records.set(run.id, structuredClone(run)),
  };
  let engine = createAdaptiveEngine({ store });
  let state = engine.start({ task: "Calculate 18*24+75.", depth: "deep" });
  state = send(engine, state, step("EXPAND", {
    candidate: { id: "C1", strategy: "injected error", answer: "497" },
  }));
  state = send(engine, state, step("BRANCH", {
    candidate: { id: "C2", strategy: "distributive law", answer: "507" },
  }));
  state = send(engine, state, step("CHALLENGE", {
    review: makeReview("C1", 1, { compared_candidate_ids: ["C2"] }),
    issue: { candidate_id: "C1", state: "error", description: "497 is wrong." },
  }));
  state = send(engine, state, step("REVISE", {
    candidate: { id: "C1", strategy: "corrected multiplication", answer: "507" },
    resolve_issue: 1,
  }));
  state = send(engine, state, step("VERIFY", {
    review: makeReview("C1", 2, { compared_candidate_ids: ["C2"] }),
    resolve_issue: 1, proposed_action: "FINALIZE",
  }));
  assert.equal(state.action, "FINALIZE");
  engine = createAdaptiveEngine({ store });
  state = engine.status(state.run_id, { detail: "full" });
  assert.equal(state.completion_blockers, undefined);
  assert.equal(state.evidence[0].superseded, true);
  state = send(engine, state, {
    kind: "adaptive_final", selected_candidate_id: "C1", selected_candidate_version: 2,
  });
  assert.equal(state.status, "completed");
  assert.equal(state.final.answer, "507");
  assert.equal(state.final.stop_reason, "ready");
});

test("deep comparison still rejects self-only and stale alternative versions", () => {
  const engine = fixture();
  let state = engine.start({ task: "Compare methods.", depth: "deep" });
  state = send(engine, state, step("EXPAND", { candidate: makeCandidate() }));
  state = send(engine, state, step("BRANCH", {
    candidate: { id: "C2", strategy: "counting", answer: "4" },
  }));
  state = send(engine, state, step("CHALLENGE", {
    review: makeReview("C1", 1, { compared_candidate_ids: ["C1"] }),
    proposed_action: "FINALIZE",
  }));
  assert.match(state.completion_blockers.join(" "), /comparison/);
  state = send(engine, state, step("CHALLENGE", {
    review: makeReview("C1", 1, { compared_candidate_ids: ["C2"] }),
    proposed_action: "REVISE",
  }));
  state = send(engine, state, step("REVISE", {
    candidate: { id: "C2", strategy: "recount", answer: "4" }, affected_candidate_id: "C1",
    proposed_action: "FINALIZE",
  }));
  assert.equal(state.action, "CHALLENGE");
  assert.match(state.completion_blockers.join(" "), /comparison/);
  state = send(engine, state, step("CHALLENGE", {
    review: makeReview("C1", 1, { compared_candidate_ids: ["C2"] }),
    finalize: { selected_candidate_id: "C1", selected_candidate_version: 1 },
  }));
  assert.equal(state.status, "completed");
});
