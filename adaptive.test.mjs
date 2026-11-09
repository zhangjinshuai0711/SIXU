import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAdaptive } from "./adaptive.mjs";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "sixu-adaptive-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, controller: createAdaptive({ directory }) };
}
const step = (action, extra = {}) => ({
  kind: "adaptive_step", action, summary: "A concrete finding.", progress: true,
  rationale: "This is the next question.", ...extra,
});
const candidate = (answer = "15") => ({ id: "C1", strategy: "greedy", answer });
const send = (controller, state, artifact) => controller.submit({
  run_id: state.run_id, stage_key: state.stage_key, artifact,
});
const full = (controller, state) => controller.status(state.run_id, { detail: "full" });
const review = (candidateId, candidateVersion) => ({
  candidate_id: candidateId, candidate_version: candidateVersion, finding: "Checked against the original task.",
});

test("reported error schedules repair, preserves replacement history, and resumes after restart", t => {
  const { directory, controller } = fixture(t);
  const start = controller.start({ task: "Find a schedule." });
  let state = send(controller, start, step("EXPAND", {
    candidate: candidate(), issue: { candidate_id: "C1", state: "error", description: "Violates a constraint." },
    proposed_action: "FINALIZE",
  }));
  assert.equal(state.action, "REVISE");
  assert.equal(send(controller, start, step("EXPAND")).status, "rejected");
  const resumed = createAdaptive({ directory });
  assert.equal(resumed.status(start.run_id).stage_key, state.stage_key);
  state = send(resumed, state, step("REVISE", {
    candidate: candidate("14"), resolve_issue: 1, proposed_action: "FINALIZE",
  }));
  assert.equal(state.action, "VERIFY");
  state = full(resumed, state);
  assert.equal(state.current_candidate.answer, "14");
  assert.equal(state.history.find(h => h.replaced_candidate).replaced_candidate.answer, "15");
  state = send(resumed, state, step("VERIFY", {
    review: review("C1", 2), resolve_issue: 1,
    finalize: { selected_candidate_id: "C1", selected_candidate_version: 2 },
  }));
  assert.equal(state.status, "completed");
  assert.match(state.limitations, /not independent verification/);
  assert.equal(createAdaptive({ directory }).status(start.run_id).final.answer, "14");
});

test("verification signals, unresolved errors, and budgets are not treated as proof", t => {
  const { controller } = fixture(t);
  let state = controller.start({ task: "Analyze.", budget: { max_steps: 3, max_revisions: 0 } });
  state = send(controller, state, step("EXPAND", {
    candidate: candidate(), issue: { candidate_id: "C1", state: "testable", description: "Check constraint." },
  }));
  assert.equal(state.action, "VERIFY");
  state = send(controller, state, step("VERIFY", {
    evidence: { candidate_id: "C1", candidate_version: 1, type: "external_report", description: "Model says a test passed." },
    review: review("C1", 1),
    resolve_issue: 1, issue: { candidate_id: "C1", state: "error", description: "Another problem." },
  }));
  assert.equal(full(controller, state).evidence.find(entry => entry.type === "external_report").verification, "unverified_report");
  assert.equal(state.action, "FINALIZE");
  assert.equal(send(controller, state, {
    kind: "adaptive_final", selected_candidate_id: "C1", selected_candidate_version: 1, answer: "Unknown",
  }).status, "rejected");
  assert.equal(send(controller, state, {
    kind: "adaptive_final", selected_candidate_id: "C1", selected_candidate_version: 1, unresolved: [],
  }).final.unresolved.includes("Another problem."), true);
});

test("branch and no-progress limits force bounded finalization", t => {
  const { controller } = fixture(t);
  let state = controller.start({ task: "Analyze.", budget: { max_steps: 4, max_candidates: 2, max_no_progress: 2 } });
  state = send(controller, state, step("EXPAND", { candidate: candidate(), proposed_action: "BRANCH" }));
  assert.equal(state.action, "BRANCH");
  assert.equal(send(controller, state, step("BRANCH")).status, "rejected");
  state = send(controller, state, step("BRANCH", {
    candidate: { id: "C2", strategy: "search", answer: "14" }, progress: false, proposed_action: "BRANCH",
  }));
  assert.equal(state.action, "CHALLENGE");
  state = send(controller, state, step("CHALLENGE", { progress: false, proposed_action: "EXPAND" }));
  assert.equal(state.budget.consecutive_no_progress, 1);
  state = send(controller, state, step("EXPAND", { progress: true, proposed_action: "CHALLENGE" }));
  assert.equal(state.action, "FINALIZE");
  assert.equal(state.budget.consecutive_no_progress, 2);
  assert.match(state.action_reason, /step_budget/);
});

test("a checked unresolved issue permits revision rather than repeated forced verification", t => {
  const { directory, controller } = fixture(t);
  let state = controller.start({ task: "Design an agenda with accountable action items." });
  state = send(controller, state, step("EXPAND", {
    candidate: candidate("Agenda without action owners."), proposed_action: "CHALLENGE",
  }));
  state = send(controller, state, step("CHALLENGE", {
    affected_candidate_id: "C1",
    issue: { candidate_id: "C1", state: "testable", description: "Action ownership may be missing." },
    proposed_action: "REVISE",
  }));
  assert.equal(state.action, "VERIFY");
  state = send(controller, state, step("VERIFY", {
    affected_candidate_id: "C1", summary: "The agenda lacks an ownership checklist.",
    review: review("C1", 1),
    proposed_action: "REVISE",
  }));
  assert.equal(state.action, "REVISE");
  const resumed = createAdaptive({ directory });
  assert.equal(resumed.status(state.run_id).action, "REVISE");
  state = send(resumed, state, step("REVISE", {
    candidate: candidate("Agenda with owner, deadline and acceptance checklist."),
    resolve_issue: 1, proposed_action: "FINALIZE",
  }));
  assert.equal(state.issues[0].resolved, false);
  assert.equal(state.budget.revisions_used, 1);
  assert.equal(state.action, "VERIFY");
  state = send(resumed, state, step("VERIFY", {
    review: review("C1", 2), resolve_issue: 1, proposed_action: "FINALIZE",
  }));
  assert.equal(full(resumed, state).issues[0].resolved, true);
  assert.equal(state.action, "FINALIZE");
});

test("new issues require a fresh check and checks of another candidate do not count", t => {
  const { controller } = fixture(t);
  let state = controller.start({ task: "Compare two plans." });
  state = send(controller, state, step("EXPAND", {
    candidate: candidate(), proposed_action: "BRANCH",
  }));
  state = send(controller, state, step("BRANCH", {
    candidate: { id: "C2", strategy: "alternative", answer: "Another plan." },
    affected_candidate_id: "C1",
    issue: { candidate_id: "C1", state: "testable", description: "Check first plan." },
  }));
  state = send(controller, state, step("VERIFY", { affected_candidate_id: "C2", proposed_action: "CHALLENGE" }));
  assert.equal(state.action, "CHALLENGE");
  assert.equal(state.issues.find(issue => issue.candidate_id === "C1").resolved, false);
  state = send(controller, state, step("CHALLENGE", {
    affected_candidate_id: "C1", review: review("C1", 1), resolve_issue: 1,
    issue: { candidate_id: "C1", state: "testable", description: "A newly discovered issue." },
    proposed_action: "REVISE",
  }));
  assert.equal(state.action, "VERIFY");
  state = send(controller, state, step("VERIFY", {
    affected_candidate_id: "C1", review: review("C1", 1), resolve_issue: 2, proposed_action: "REVISE",
  }));
  assert.equal(state.action, "REVISE");
});
