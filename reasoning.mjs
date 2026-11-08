import { randomUUID } from "node:crypto";
import { z } from "zod";
import { case01, gradeCase } from "./cases.mjs";

const short = z.string().trim().min(1).max(600);
const index = z.number().int().min(0).max(11);
export const artifactSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("plan"), goal: short,
    constraints: z.array(short).min(1).max(12),
    subproblems: z.array(z.object({
      id: z.string().regex(/^S[1-4]$/), question: short,
      depends_on: z.array(z.string().regex(/^S[1-4]$/)).max(3),
    })).min(2).max(4),
  }),
  z.object({
    kind: z.literal("solve"), subproblem_id: z.string(),
    result: z.string().trim().min(1).max(2500),
    evidence: z.array(short).max(6),
  }),
  z.object({
    kind: z.literal("review"),
    checks: z.array(z.object({ constraint_index: index, finding: short })).min(1).max(12),
    issues: z.array(z.object({ subproblem_id: z.string(), problem: short, basis: short })).max(2),
  }),
  z.object({
    kind: z.literal("final"), answer: z.string().trim().min(1).max(6500),
    covered_constraint_indices: z.array(index).min(1).max(12),
    conclusions: z.array(z.object({
      subproblem_id: z.string(),
      disposition: z.enum(["confirmed", "revised", "unresolved"]),
      result: z.string().trim().min(1).max(2500),
      basis: short,
    })).min(2).max(4),
    unresolved: z.array(short).max(12),
    result: z.record(z.string(), z.unknown()).optional(),
  }),
]);

const instructions = {
  plan: "Submit kind=plan: a goal, all material constraints, and 2-4 subproblems S1... in dependency order. Each subproblem must produce a useful intermediate result. Do not submit a final answer yet.",
  solve: "Solve only current_subproblem using the task and stored results. Submit kind=solve with that subproblem_id, a concise result and evidence. Provide conclusions and checkable support, not private chain-of-thought.",
  repair: "Repair current_subproblem in light of pending_issues. Submit kind=solve with the same subproblem_id. Preserve unrelated correct results.",
  review: "Submit kind=review. Check every constraint by its zero-based index and compare the stored subproblem results for conflicting or outdated claims. Report at most 2 concrete issues with supporting basis and the affected subproblem_id, or an empty issues list if none found. This is same-model review, not independent verification.",
  synthesize: "Submit kind=final with answer, all covered_constraint_indices, unresolved issues, and result if the task requests structured data. Include conclusions for EVERY planned subproblem exactly once: subproblem_id, disposition (confirmed/revised/unresolved), result, basis. For confirmed, copy the stored result exactly; for revised, give its replacement and reason, checking dependent conclusions too. Mark remaining review issues unresolved. Use these reconciled conclusions consistently in answer and result. These are model-reported checks, not semantic verification.",
};

export function createReasoning({ onEvent = () => {}, ttlMs = 2 * 60 * 60 * 1000 } = {}) {
  const runs = new Map();
  function lookup(id) {
    const run = runs.get(id);
    if (!run || Date.now() - run.createdAt > ttlMs) throw new Error("Reasoning run missing or expired.");
    return run;
  }
  function view(run) {
    const current = run.phase === "repair" ? run.repairIds[run.cursor] : run.plan?.subproblems[run.cursor]?.id;
    return {
      run_id: run.id, stage_key: run.stageKey, phase: run.phase,
      task: run.task, case_id: run.caseId, feedback: run.feedback,
      plan: run.plan, stored_results: run.solutions,
      ...(run.phase === "solve" || run.phase === "repair" ? {
        current_subproblem: run.plan.subproblems.find(item => item.id === current),
      } : {}),
      pending_issues: run.issues, reviews_completed: run.reviews.length,
      results_requiring_recompute: run.phase === "repair" ? run.repairIds.slice(run.cursor) : [],
      submission_budget_remaining: 18 - run.attempts,
      next_action: instructions[run.phase],
      limitations: "This server enforces phase order and structure. It does not invoke LLMs, create independent model contexts, or validate arbitrary semantic claims. Evidence fields are model-reported.",
    };
  }
  function reject(run, errors) {
    onEvent({ event: "reasoning_rejected", run_id: run.id, phase: run.phase, errors });
    return { status: "rejected", errors, ...view(run) };
  }
  function advance(run, phase) {
    run.phase = phase;
    run.stageKey = randomUUID();
    return { status: "accepted", ...view(run) };
  }
  function completion(run) {
    return {
      status: run.phase, run_id: run.id, protocol_completed: run.phase === "completed",
      answer: run.final?.answer, result: run.final?.result, unresolved: run.final?.unresolved,
      canonical_findings: run.canonicalFindings,
      unresolved_subproblems: run.canonicalFindings.filter(item => item.disposition === "unresolved").map(item => item.subproblem_id),
      submission_count: run.attempts,
      verification: run.caseId
        ? (run.feedback === "objective" ? run.grade : "Objective score withheld for comparison; recorded on server.")
        : "Structure and phase order checked; semantic correctness remains unverified.",
      next_action: "Return the synthesized answer and run_id to the user. Report unresolved limitations. Do not claim a different reasoning tier or independent models were used.",
    };
  }
  return {
    start({ task, case_id, feedback = "none", client_tag = "unspecified" } = {}) {
      if (case_id && (task || case_id !== case01.id)) throw new Error("Supply either task or the supported case_id.");
      if (!case_id && (!task?.trim() || task.length > 12000)) throw new Error("Supply a nonempty task up to 12000 characters.");
      if (!["none", "objective"].includes(feedback)) throw new Error("Unknown feedback mode.");
      if (!case_id && feedback === "objective") throw new Error("Objective feedback is supported only for the fixed benchmark case.");
      for (const [id, run] of runs) if (Date.now() - run.createdAt > ttlMs) runs.delete(id);
      if (runs.size >= 64) throw new Error("Reasoning run limit reached.");
      const run = {
        id: randomUUID(), stageKey: randomUUID(), createdAt: Date.now(),
        task: case_id ? case01.question : task.trim(), caseId: case_id,
        feedback, clientTag: client_tag, phase: "plan", cursor: 0,
        attempts: 0, finalAttempts: 0, plan: null, solutions: {},
        reviews: [], issues: [], repairIds: [], final: null, canonicalFindings: [],
      };
      runs.set(run.id, run);
      onEvent({ event: "reasoning_started", run_id: run.id, task: run.task, case_id, feedback, client_tag });
      return view(run);
    },
    submit({ run_id, stage_key, artifact }) {
      const run = lookup(run_id);
      if (["completed", "stopped"].includes(run.phase)) return completion(run);
      if (run.attempts >= 18) {
        run.phase = "stopped";
        onEvent({ event: "reasoning_stopped", run_id, reason: "Submission budget exhausted." });
        return completion(run);
      }
      // Stale submissions also consume budget to avoid unlimited replay loops.
      run.attempts++;
      if (stage_key !== run.stageKey) return reject(run, ["Stale stage key; use the current stage_key."]);
      const parsed = artifactSchema.safeParse(artifact);
      if (!parsed.success) return reject(run, parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`));
      const data = parsed.data;
      onEvent({ event: "reasoning_submission", run_id, phase: run.phase, artifact: data });
      if (run.phase === "plan") {
        if (data.kind !== "plan") return reject(run, ["A plan is required before solving."]);
        const seen = new Set();
        for (const item of data.subproblems) {
          if (seen.has(item.id) || item.depends_on.some(id => !seen.has(id))) {
            return reject(run, ["Subproblem IDs must be unique and dependencies must refer only to earlier subproblems."]);
          }
          seen.add(item.id);
        }
        run.plan = data;
        return advance(run, "solve");
      }
      if (run.phase === "solve" || run.phase === "repair") {
        const expected = run.phase === "solve" ? run.plan.subproblems[run.cursor].id : run.repairIds[run.cursor];
        if (data.kind !== "solve" || data.subproblem_id !== expected) return reject(run, [`Submit a solve artifact for ${expected}.`]);
        run.solutions[expected] = data;
        run.cursor++;
        const count = run.phase === "solve" ? run.plan.subproblems.length : run.repairIds.length;
        if (run.cursor < count) return advance(run, run.phase);
        return advance(run, "review");
      }
      if (run.phase === "review") {
        if (data.kind !== "review") return reject(run, ["Review is required before synthesis."]);
        const covered = new Set(data.checks.map(check => check.constraint_index));
        if (data.checks.some(check => check.constraint_index >= run.plan.constraints.length) ||
            run.plan.constraints.some((_, i) => !covered.has(i))) return reject(run, ["Review must cover every valid constraint index."]);
        if (data.issues.some(issue => !run.solutions[issue.subproblem_id])) return reject(run, ["Each issue must refer to an existing subproblem."]);
        run.reviews.push(data);
        run.issues = data.issues;
        if (data.issues.length && run.reviews.length === 1) {
          const affected = new Set(data.issues.map(issue => issue.subproblem_id));
          for (const item of run.plan.subproblems) {
            if (item.depends_on.some(id => affected.has(id))) affected.add(item.id);
          }
          run.repairIds = run.plan.subproblems.filter(item => affected.has(item.id)).map(item => item.id);
          run.cursor = 0;
          return advance(run, "repair");
        }
        return advance(run, "synthesize");
      }
      if (run.phase === "synthesize") {
        if (data.kind !== "final") return reject(run, ["Submit a final artifact to synthesize results."]);
        const covered = new Set(data.covered_constraint_indices);
        if (data.covered_constraint_indices.some(i => i >= run.plan.constraints.length) ||
            run.plan.constraints.some((_, i) => !covered.has(i))) return reject(run, ["Final artifact must cover every valid constraint index."]);
        const reconciled = new Map(data.conclusions.map(item => [item.subproblem_id, item]));
        if (reconciled.size !== data.conclusions.length ||
            data.conclusions.length !== run.plan.subproblems.length ||
            run.plan.subproblems.some(item => !reconciled.has(item.id))) {
          return reject(run, ["Conclusions must cover every planned subproblem exactly once."]);
        }
        if (data.conclusions.some(item => item.disposition === "confirmed" &&
            item.result !== run.solutions[item.subproblem_id].result)) {
          return reject(run, ["A confirmed conclusion must copy its stored result exactly; use revised for a replacement."]);
        }
        if (data.conclusions.some(item => item.disposition === "unresolved") && data.unresolved.length === 0) {
          return reject(run, ["List unresolved conclusions in unresolved."]);
        }
        if (run.issues.length && data.unresolved.length === 0) return reject(run, ["List remaining review issues in unresolved."]);
        if (run.issues.some(issue => reconciled.get(issue.subproblem_id).disposition !== "unresolved")) {
          return reject(run, ["Conclusions affected by remaining review issues must be marked unresolved."]);
        }
        run.finalAttempts++;
        run.final = data;
        run.grade = run.caseId ? gradeCase(run.caseId, data.result) : undefined;
        onEvent({ event: "reasoning_final", run_id, feedback: run.feedback, objective_grade: run.grade, artifact: data });
        if (run.grade && !run.grade.passed && run.feedback === "objective") {
          if (run.finalAttempts < 2) return reject(run, run.grade.errors);
        }
        const previousResults = structuredClone(run.solutions);
        run.canonicalFindings = data.conclusions;
        run.solutions = Object.fromEntries(data.conclusions.map(item => [
          item.subproblem_id, {
            ...run.solutions[item.subproblem_id], result: item.result,
            evidence: item.disposition === "confirmed" ? run.solutions[item.subproblem_id].evidence : [item.basis],
          },
        ]));
        onEvent({
          event: "reasoning_reconciled", run_id,
          previous_results: previousResults, stored_results: structuredClone(run.solutions),
          conclusions: data.conclusions,
        });
        if (run.grade && !run.grade.passed && run.feedback === "objective") {
          run.phase = "stopped";
          onEvent({ event: "reasoning_stopped", run_id, reason: "Objective verification failed twice." });
          return completion(run);
        }
        run.phase = "completed";
        onEvent({
          event: "reasoning_completed", run_id, submissions: run.attempts,
          objective_passed: run.grade?.passed ?? null,
          semantic_verification: run.caseId ? "fixed-case-checker" : "unverified",
        });
        return completion(run);
      }
      return reject(run, ["Unsupported phase."]);
    },
    status(run_id) {
      const run = lookup(run_id);
      return ["completed", "stopped"].includes(run.phase) ? completion(run) : view(run);
    },
  };
}
