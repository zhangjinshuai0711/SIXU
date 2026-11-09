import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requirementSchema, checkSchema, validateDefinitions, validateJson, runChecks, sameJson } from "./verification.mjs";

export const SERVICE_VERSION = "0.4.0";
const STATE_VERSION = 4;
export class AdaptiveInputError extends Error {}
const text = z.string().trim().min(1).max(2500);
const id = z.string().regex(/^C[1-9][0-9]*$/);
const version = z.number().int().positive();
const action = z.enum(["EXPAND", "BRANCH", "CHALLENGE", "VERIFY", "REVISE"]);
const jsonResult = z.record(z.string(), z.unknown());
const choice = {
  selected_candidate_id: id.optional(), selected_candidate_version: version.optional(),
  answer: text.optional(), result: jsonResult.optional(), unresolved: z.array(text).max(64).default([]),
};
export const adaptiveArtifactSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("adaptive_step"), action, summary: text,
    candidate: z.object({ id, strategy: text, answer: text, result: jsonResult.optional() }).strict().optional(),
    affected_candidate_id: id.optional(),
    issue: z.object({ description: text, state: z.enum(["error", "testable", "stuck", "open"]), candidate_id: id }).strict().optional(),
    resolve_issue: z.number().int().positive().optional(),
    resolve_issues: z.array(z.number().int().positive()).max(64).optional(),
    evidence: z.object({ candidate_id: id, candidate_version: version.optional(), description: text,
      type: z.enum(["model_review", "external_report"]) }).strict().optional(),
    review: z.object({ candidate_id: id, candidate_version: version, finding: text,
      requirement_ids: z.array(z.string().max(64)).max(64).default([]),
      compared_candidate_ids: z.array(id).max(6).default([]) }).strict().optional(),
    add_requirements: z.array(requirementSchema).max(64).optional(),
    add_checks: z.array(checkSchema).max(32).optional(),
    finalize: z.object(choice).strict().optional(),
    progress: z.boolean().optional(),
    proposed_action: z.enum(["EXPAND", "BRANCH", "CHALLENGE", "VERIFY", "REVISE", "FINALIZE"]).optional(),
    rationale: text,
  }).strict(),
  z.object({ kind: z.literal("adaptive_final"), ...choice }).strict(),
]);
export const budgetSchema = z.object({
  max_steps: z.number().int().min(1).max(20).optional(),
  max_candidates: z.number().int().min(1).max(6).optional(),
  max_revisions: z.number().int().min(0).max(6).optional(),
  max_no_progress: z.number().int().min(1).max(5).optional(),
}).strict();
const presets = {
  medium: { max_steps: 8, max_candidates: 3, max_revisions: 2, max_no_progress: 2 },
  deep: { max_steps: 12, max_candidates: 4, max_revisions: 3, max_no_progress: 3 },
};
const descriptions = {
  EXPAND: "Construct a complete candidate answer and bounded JSON result for declared checks.",
  BRANCH: "Construct a materially different candidate; this is not independent model sampling.",
  CHALLENGE: "Review the targeted candidate VERSION for counterexamples and original requirements. Submit review with candidate_id, candidate_version, finding and covered requirement_ids (or legacy evidence with type=model_review when review is unavailable in the host schema); summary alone is not a review. Deep reviews must compare candidate IDs (e.g. C1 vs C2). Include finalize with selected_candidate_id and selected_candidate_version, or set proposed_action=FINALIZE to request a separate final step.",
  VERIFY: "Review the targeted candidate VERSION and unresolved issues. Submit review (or legacy evidence with type=model_review) and use resolve_issues/resolve_issue only after a concrete review addresses them. Service checks execute automatically.",
  REVISE: "Submit a complete replacement candidate with the SAME ID. Previous checks reopen; do not claim that revision alone resolves them.",
  FINALIZE: "Submit adaptive_final selecting an existing candidate ID and VERSION; omit answer/result to use stored canonical values. Remaining issues are included by the service.",
};
const limitation = "Service checks cover only supplied structured requirements, not their completeness or arbitrary prose. Model reviews and external reports are not independent verification. Protocol completion is not correctness.";
const openIssues = (run, candidateId) => run.issues.filter(issue => !issue.resolved && issue.candidate_id === candidateId);
const currentEvidence = (run, candidate) => run.evidence.filter(entry =>
  entry.candidate_id === candidate.id && entry.candidate_version === candidate.version && !entry.superseded);
function bestCandidate(run) {
  return [...run.candidates].sort((left, right) => {
    const penalty = candidate => openIssues(run, candidate.id).reduce((total, issue) =>
      total + (issue.state === "error" ? 4 : 1), 0);
    return penalty(left) - penalty(right) || Number(right.id === run.activeId) - Number(left.id === run.activeId);
  })[0];
}
function gates(run, candidate) {
  const missing = [];
  if (!candidate) return ["No candidate available."];
  const evidence = currentEvidence(run, candidate);
  if (!evidence.some(entry => entry.type === "model_review" && entry.verification === "model_reported"))
    missing.push("Selected version needs a targeted model review.");
  for (const requirement of run.requirements) {
    if (requirement.method === "model" && !evidence.some(entry => entry.verification === "model_reported" &&
      entry.requirement_ids?.includes(requirement.id))) missing.push(`Model requirement ${requirement.id} not reviewed.`);
  }
  for (const check of run.checks) {
    if (!evidence.some(entry => entry.check_id === check.id)) missing.push(`Check ${check.id} not executed.`);
  }
  if (run.depth === "deep" && !evidence.some(entry => entry.verification === "model_reported" &&
      new Set([candidate.id, ...entry.compared_candidate_ids]).size >= 2 &&
      entry.compared_versions?.every(reference => run.candidates.some(current =>
        current.id === reference.id && current.version === reference.version))))
    missing.push("Deep mode requires comparison of at least two candidates.");
  missing.push(...openIssues(run, candidate.id).map(issue => issue.description));
  return [...new Set(missing)];
}
function chooseNext(run, proposed) {
  const candidate = run.candidates.find(entry => entry.id === run.activeId) ?? bestCandidate(run);
  const open = candidate ? openIssues(run, candidate.id) : [];
  if (run.depth === "medium" && run.autoUpgrade &&
      ((run.revisions >= 1 && open.some(issue => issue.state === "error" && !issue.needs_review)) ||
       (run.noProgress >= run.budget.max_no_progress && open.some(issue => ["error", "stuck"].includes(issue.state))))) {
    run.depth = "deep";
    run.upgradeReason = run.revisions >= 1 ? "Error persists after revision." : "No progress with unresolved error or stuck path.";
    run.budget = { ...presets.deep, ...run.customBudget };
  }
  if (run.used >= run.budget.max_steps) return ["FINALIZE", "step_budget_exhausted"];
  if (run.noProgress >= run.budget.max_no_progress) return ["FINALIZE", "no_progress_limit"];
  if (open.some(issue => issue.state === "error" && !issue.needs_review)) {
    if (run.revisions >= run.budget.max_revisions) return ["FINALIZE", "revision_budget_exhausted"];
    return ["REVISE", "Reported or service-detected error requires repair."];
  }
  if (open.some(issue => issue.needs_review || (issue.state === "testable" &&
      !currentEvidence(run, candidate).some(entry => entry.verification === "model_reported" && entry.step > issue.created_step))))
    return ["VERIFY", "Current version needs a targeted recheck."];
  if (!candidate) return ["EXPAND", "Construct an initial candidate."];
  if ((run.depth === "deep" && run.candidates.length < 2) || open.some(issue => issue.state === "stuck")) {
    if (run.candidates.length < run.budget.max_candidates) return ["BRANCH", "Compare another strategy."];
    if (run.depth === "deep" && run.candidates.length < 2) return ["FINALIZE", "candidate_budget_exhausted"];
  }
  if (proposed === "FINALIZE") {
    if (gates(run, candidate).length) return ["CHALLENGE", "Completion requirements remain; review the best supported candidate."];
    return ["FINALIZE", "ready"];
  }
  if (proposed === "REVISE" && run.revisions >= run.budget.max_revisions) return ["FINALIZE", "revision_budget_exhausted"];
  if (proposed === "BRANCH" && run.candidates.length >= run.budget.max_candidates) return ["CHALLENGE", "Candidate limit reached."];
  return [proposed || "CHALLENGE", "Model proposal or targeted review."];
}
const forced = run => ["step_budget_exhausted", "no_progress_limit", "revision_budget_exhausted", "candidate_budget_exhausted"].includes(run.actionReason);

export function createAdaptiveEngine({ store, onEvent = () => {}, ttlMs = 2 * 60 * 60 * 1000 } = {}) {
  if (!store) throw new Error("Adaptive state store required.");
  function load(runId) {
    if (!z.string().uuid().safeParse(runId).success) throw new Error("Invalid run ID.");
    const run = store.load(runId);
    if (!run) throw new Error("Adaptive run missing.");
    if (Date.now() - run.createdAt > ttlMs) throw new Error("Adaptive run expired.");
    return structuredClone(run);
  }
  function view(run, { detail = "compact", includeTask = false } = {}) {
    if (run.stateVersion !== STATE_VERSION) return { ...run, run_id: run.id, legacy_read_only: true,
      next_action: "Legacy adaptive run is read-only. Start a new v0.4 task.", service_version: SERVICE_VERSION };
    const candidate = run.candidates.find(entry => entry.id === run.activeId) ?? bestCandidate(run);
    const blockers = run.status === "completed" ? [] : run.completionBlockers ?? (candidate ? gates(run, candidate) : []);
    const output = {
      run_id: run.id, service_version: SERVICE_VERSION, state_version: run.stateVersion,
      strategy: "adaptive_search", stage_key: run.stageKey, status: run.status,
      depth: { requested: run.requestedDepth, actual: run.depth, upgrade_reason: run.upgradeReason },
      action: run.action, action_reason: run.actionReason,
      budget: { ...run.budget, used_steps: run.used, revisions_used: run.revisions, consecutive_no_progress: run.noProgress },
      current_candidate: candidate ?? null,
      candidates: detail === "full" ? run.candidates : run.candidates.map(entry => ({
        id: entry.id, version: entry.version, strategy: entry.strategy.slice(0, 160),
      })),
      issues: detail === "full" ? run.issues : run.issues.filter(issue => !issue.resolved),
      verification: {
        checks_declared: run.checks.length,
        results: candidate ? currentEvidence(run, candidate).filter(entry => entry.verification === "service_executed") : [],
        coverage: run.requirements.map(requirement => ({
          id: requirement.id, method: requirement.method,
          checked: Boolean(candidate && currentEvidence(run, candidate).some(entry =>
            entry.requirement_id === requirement.id || entry.requirement_ids?.includes(requirement.id))),
        })),
        extraction_completeness: "model_reported_not_verified",
      },
      changes: run.history.at(-1) ? { step: run.used, summary: run.history.at(-1).summary, action: run.history.at(-1).action } : null,
      metrics: run.metrics, final: run.final,
      ...(blockers.length ? { completion_blockers: blockers } : {}),
      next_action: run.status === "completed" ? "Return final.answer and final.result as authoritative; explain unresolved issues, verification limits and actual run_id." :
        `${descriptions[run.action]} Use the latest stage_key. Review submissions may include finalize with ID/version to finish in the same call if all gates pass. Use concise findings, not private chain-of-thought.`,
      limitations: limitation,
    };
    if (includeTask || detail === "full") Object.assign(output, { task: run.task, requirements: run.requirements, checks: run.checks });
    if (detail === "full") Object.assign(output, { history: run.history, evidence: run.evidence });
    output.response_bytes = 0;
    for (let attempt = 0; attempt < 5; attempt++) {
      const byteLength = new TextEncoder().encode(JSON.stringify(output)).length;
      if (output.response_bytes === byteLength) break;
      output.response_bytes = byteLength;
    }
    return output;
  }
  function save(run, includeTask = false) {
    const previousBytes = run.metrics.returned_bytes;
    run.metrics.accepted_responses++;
    let output = view(run, { includeTask });
    for (let attempt = 0; attempt < 5; attempt++) {
      const total = previousBytes + output.response_bytes;
      if (run.metrics.returned_bytes === total) break;
      run.metrics.returned_bytes = total;
      output = view(run, { includeTask });
    }
    store.save(run);
    return output;
  }
  function finish(run, selection) {
    const targetId = selection.selected_candidate_id ??
      (selection.selected_candidate_version === undefined && run.candidates.length === 1 ? run.candidates[0].id : undefined);
    const candidate = run.candidates.find(entry => entry.id === targetId);
    if (!candidate && !run.candidates.length && forced(run) &&
        selection.answer === undefined && selection.result === undefined && selection.selected_candidate_id === undefined) {
      run.final = { answer: "No candidate was produced.", unresolved: ["No candidate available.", ...selection.unresolved],
        stop_reason: run.actionReason, verification_status: "incomplete", discarded_candidates: [] };
      run.status = "completed";
      run.action = "FINALIZE";
      return [];
    }
    const expectedVersion = selection.selected_candidate_version ?? candidate?.version;
    if (!candidate || candidate.version !== expectedVersion) throw new Error("Select an existing current candidate version.");
    if (selection.answer !== undefined && selection.answer !== candidate.answer) throw new Error("Final answer differs from the canonical candidate. Revise the candidate first.");
    if (selection.result !== undefined && !sameJson(selection.result, candidate.result)) throw new Error("Final result differs from the canonical candidate.");
    const missing = gates(run, candidate);
    if (missing.length && !forced(run)) return missing;
    run.final = {
      selected_candidate_id: candidate.id, selected_candidate_version: candidate.version,
      answer: candidate.answer, ...(candidate.result !== undefined ? { result: candidate.result } : {}),
      unresolved: [...new Set([...missing, ...selection.unresolved])],
      discarded_candidates: run.candidates.filter(entry => entry.id !== candidate.id).map(entry => ({
        id: entry.id, version: entry.version, remaining_issues: openIssues(run, entry.id).map(issue => issue.description),
      })),
      stop_reason: forced(run) ? run.actionReason : "ready",
      verification_status: missing.length ? "incomplete" : run.checks.length ? "declared_checks_passed" : "model_review_only",
    };
    run.activeId = candidate.id;
    run.status = "completed";
    run.action = "FINALIZE";
    run.actionReason = run.final.stop_reason;
    return [];
  }
  return {
    owns(runId) { return z.string().uuid().safeParse(runId).success && store.owns(runId); },
    start({ task, budget, feedback = "none", depth, auto_upgrade = true, requirements = [], checks = [] }) {
      if (!task?.trim() || task.length > 12000) throw new Error("Supply a nonempty task up to 12000 characters.");
      if (feedback !== "none") throw new Error("Adaptive search does not support benchmark objective feedback.");
      const inferredDepth = /^(?:\s*(?:请|使用|按|采用)?\s*(?:深度模式|深度推理|深度分析|深度|deep\b))/i.test(task) ? "deep" : "medium";
      depth = depth ?? inferredDepth;
      if (!Object.hasOwn(presets, depth)) throw new Error("Depth must be medium or deep.");
      const customBudget = budgetSchema.parse(budget ?? {});
      try {
        ({ requirements, checks } = z.object({
          requirements: z.array(requirementSchema).max(64),
          checks: z.array(checkSchema).max(32),
        }).parse({ requirements, checks }));
        validateDefinitions(task, requirements, checks);
      } catch (error) {
        const message = error instanceof z.ZodError
          ? error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ")
          : error.message;
        throw new AdaptiveInputError(message);
      }
      const run = {
        id: randomUUID(), stageKey: randomUUID(), createdAt: Date.now(), stateVersion: STATE_VERSION,
        task: task.trim(), status: "searching", action: "EXPAND", actionReason: "Construct an initial candidate.",
        requestedDepth: depth, depth, autoUpgrade: auto_upgrade, upgradeReason: null, customBudget,
        budget: { ...presets[depth], ...customBudget }, used: 0, revisions: 0, noProgress: 0, activeId: null,
        requirements, checks, candidates: [], issues: [], evidence: [], history: [], final: null,
        metrics: { accepted_responses: 0, returned_bytes: 0, checks_executed: 0, check_ms: 0 },
      };
      onEvent({ event: "adaptive_started", run_id: run.id, version: SERVICE_VERSION });
      return save(run, true);
    },
    status(runId, options = {}) { return view(load(runId), { ...options, includeTask: true }); },
    submit({ run_id, stage_key, artifact }) {
      const original = load(run_id);
      const reject = message => ({ ...view(original, { includeTask: true }), status: "rejected", errors: [message] });
      if (original.stateVersion !== STATE_VERSION) return reject("Legacy adaptive run is read-only; start a new task.");
      if (original.status === "completed") return view(original);
      if (stage_key !== original.stageKey) return reject("Stale stage key; retrieve the current state.");
      const parsed = adaptiveArtifactSchema.safeParse(artifact);
      if (!parsed.success) return reject(parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; "));
      const run = structuredClone(original);
      delete run.completionBlockers;
      const data = parsed.data;
      try {
        if (run.action === "FINALIZE") {
          if (data.kind !== "adaptive_final") throw new Error("Submit adaptive_final.");
          const missing = finish(run, data);
          if (missing.length) throw new Error(missing.join(" "));
        } else {
          if (data.kind !== "adaptive_step" || data.action !== run.action) throw new Error(`Expected adaptive_step action=${run.action}.`);
          const requirements = [...run.requirements, ...(data.add_requirements ?? [])];
          const checks = [...run.checks, ...(data.add_checks ?? [])];
          validateDefinitions(run.task, requirements, checks);
          run.requirements = requirements;
          run.checks = checks;
          const lookup = candidateId => run.candidates.find(entry => entry.id === candidateId);
          if (data.candidate && data.review) throw new Error("Review must occur in a separate step after candidate creation or revision.");
          if (data.action === "BRANCH" && !data.candidate) throw new Error("Branch requires a new candidate.");
          if (data.action === "REVISE" && (!data.candidate || !lookup(data.candidate.id))) throw new Error("Revision requires a complete existing candidate replacement.");
          if (data.candidate) {
            const previous = lookup(data.candidate.id);
            if (previous && data.action !== "REVISE") throw new Error("Existing candidates may change only through REVISE.");
            if (!previous && run.candidates.length >= run.budget.max_candidates) throw new Error("Candidate limit reached.");
            if (data.candidate.result !== undefined) validateJson(data.candidate.result);
            if (previous) {
              for (const evidence of run.evidence.filter(entry => entry.candidate_id === previous.id)) evidence.superseded = true;
              for (const issue of run.issues.filter(entry => entry.candidate_id === previous.id)) {
                issue.resolved = false;
                issue.needs_review = true;
                issue.candidate_version = previous.version + 1;
              }
            }
            const candidate = { ...data.candidate, version: (previous?.version ?? 0) + 1 };
            run.candidates = [...run.candidates.filter(entry => entry.id !== candidate.id), candidate];
            run.activeId = candidate.id;
          }
          if (data.affected_candidate_id) {
            if (!lookup(data.affected_candidate_id)) throw new Error("Unknown affected candidate.");
            run.activeId = data.affected_candidate_id;
          }
          if (data.issue) {
            const candidate = lookup(data.issue.candidate_id);
            if (!candidate) throw new Error("Unknown issue candidate.");
            if (!run.issues.some(issue => issue.candidate_id === candidate.id && !issue.resolved && issue.description === data.issue.description))
              run.issues.push({ id: run.issues.length + 1, ...data.issue, candidate_version: candidate.version,
                origin: "model", resolved: false, needs_review: false, created_step: run.used + 1 });
          }
          const candidatesToCheck = data.candidate ? [lookup(data.candidate.id)] : [];
          if (data.add_checks?.length) candidatesToCheck.push(...run.candidates.filter(entry => !candidatesToCheck.includes(entry)));
          for (const candidate of candidatesToCheck) {
            const started = Date.now();
            const results = runChecks(run.checks, candidate);
            run.metrics.check_ms += Date.now() - started;
            run.metrics.checks_executed += results.length;
            for (const result of results) {
              for (const prior of run.evidence.filter(entry => entry.candidate_id === candidate.id && entry.check_id === result.check_id))
                prior.superseded = true;
              run.evidence.push(result);
              const existingIssue = run.issues.find(issue => issue.candidate_id === candidate.id && issue.check_id === result.check_id);
              if (existingIssue) Object.assign(existingIssue, { resolved: result.passed, needs_review: false, candidate_version: candidate.version,
                description: result.errors.map(error => error.message).join(" ") || `Check ${result.check_id} passed.` });
              else if (!result.passed) run.issues.push({
                id: run.issues.length + 1, candidate_id: candidate.id, candidate_version: candidate.version,
                check_id: result.check_id, origin: "service", state: "error", resolved: false, needs_review: false,
                description: result.errors.map(error => error.message).join(" "), created_step: run.used + 1,
              });
            }
          }
          if (data.review) {
            const candidate = lookup(data.review.candidate_id);
            if (!["VERIFY", "CHALLENGE"].includes(data.action) || !candidate || candidate.version !== data.review.candidate_version)
              throw new Error("Review must target an existing current version in VERIFY or CHALLENGE.");
            if (data.review.requirement_ids.some(requirementId => !run.requirements.some(entry => entry.id === requirementId)) ||
                data.review.compared_candidate_ids.some(candidateId => !lookup(candidateId)))
              throw new Error("Unknown reviewed requirement or compared candidate.");
            const review = { ...data.review, type: "model_review", verification: "model_reported",
              compared_versions: data.review.compared_candidate_ids.map(candidateId => ({
                id: candidateId, version: lookup(candidateId).version,
              })) };
            if (!currentEvidence(run, candidate).some(({ step: previousStep, ...entry }) => sameJson(entry, review)))
              run.evidence.push({ ...review, step: run.used + 1 });
            for (const issue of openIssues(run, candidate.id)) issue.needs_review = false;
            run.activeId = candidate.id;
          }
          if (!data.review && data.evidence?.type === "model_review" && ["VERIFY", "CHALLENGE"].includes(data.action)) {
            const candidate = lookup(data.evidence.candidate_id);
            const targetVersion = data.evidence.candidate_version ?? candidate?.version;
            if (!candidate || candidate.version !== targetVersion)
              throw new Error("Evidence targets a stale or missing candidate.");
            const mentionedCandidates = [...new Set(
              [candidate.id, ...([...`${data.evidence.description} ${data.summary}`.matchAll(/\bC[1-9][0-9]*\b/g)].map(m => m[0]))]
                .filter(candidateId => lookup(candidateId)),
            )];
            const mentionedRequirements = run.requirements
              .filter(req => req.method === "model" && (`${data.evidence.description} ${data.summary}`.includes(req.id) || `${data.evidence.description} ${data.summary}`.includes(req.quote)))
              .map(req => req.id);
            const review = {
              candidate_id: candidate.id, candidate_version: candidate.version,
              finding: data.evidence.description, requirement_ids: mentionedRequirements,
              compared_candidate_ids: mentionedCandidates.length >= 2 ? mentionedCandidates : [],
              type: "model_review", verification: "model_reported",
              compared_versions: (mentionedCandidates.length >= 2 ? mentionedCandidates : []).map(candidateId => ({
                id: candidateId, version: lookup(candidateId).version,
              })),
            };
            if (!currentEvidence(run, candidate).some(({ step: previousStep, ...entry }) => sameJson(entry, review)))
              run.evidence.push({ ...review, step: run.used + 1 });
            for (const issue of openIssues(run, candidate.id)) issue.needs_review = false;
            run.activeId = candidate.id;
          }
          const resolvedIds = [...(data.resolve_issues ?? []), ...(data.resolve_issue ? [data.resolve_issue] : [])];
          const activeReview = data.review ?? (data.evidence?.type === "model_review" && ["VERIFY", "CHALLENGE"].includes(data.action)
            ? { candidate_id: data.evidence.candidate_id, candidate_version: data.evidence.candidate_version ?? lookup(data.evidence.candidate_id)?.version }
            : null);
          if (resolvedIds.length && data.action !== "REVISE") {
            for (const issueId of resolvedIds) {
              const issue = run.issues.find(entry => entry.id === issueId && !entry.resolved);
              if (!issue || issue.origin === "service" || !activeReview ||
                  issue.candidate_id !== activeReview.candidate_id || issue.candidate_version !== activeReview.candidate_version)
                throw new Error("Only a current-version targeted model review may resolve model issues; service failures need a passing check.");
              issue.resolved = true;
              issue.resolved_version = activeReview.candidate_version;
            }
          }
          if (data.evidence) {
            const candidate = lookup(data.evidence.candidate_id);
            const targetVersion = data.evidence.candidate_version ?? candidate?.version;
            if (!candidate || candidate.version !== targetVersion) throw new Error("Evidence targets a stale or missing candidate.");
            if (!(data.evidence.type === "model_review" && ["VERIFY", "CHALLENGE"].includes(data.action))) {
              const evidence = { ...data.evidence, candidate_version: targetVersion, verification: "unverified_report" };
              if (!run.evidence.some(entry => sameJson(entry, evidence))) run.evidence.push(evidence);
            }
          }
          run.used++;
          if (data.action === "REVISE") run.revisions++;
          const changedCandidate = data.candidate && !sameJson(
            { ...lookup(data.candidate.id), version: null },
            { ...original.candidates.find(entry => entry.id === data.candidate.id), version: null });
          const progressed = changedCandidate || run.evidence.length > original.evidence.length ||
            !sameJson(run.issues, original.issues) || run.requirements.length > original.requirements.length;
          run.noProgress = progressed ? 0 : run.noProgress + 1;
          run.history.push({ ...data, step: run.used, actual_progress: Boolean(progressed),
            ...(data.candidate ? { candidate_version: lookup(data.candidate.id).version } : {}),
            ...(data.action === "REVISE" ? { replaced_candidate: original.candidates.find(entry => entry.id === data.candidate.id) } : {}) });
          [run.action, run.actionReason] = chooseNext(run, data.proposed_action);
          if (data.finalize) {
            if (!data.review) throw new Error("Combined finalization requires a targeted review.");
            const missing = finish(run, data.finalize);
            run.completionBlockers = missing;
          }
        }
      } catch (error) { return reject(error.message); }
      run.stageKey = randomUUID();
      onEvent({ event: "adaptive_advanced", run_id: run.id, action: data.kind === "adaptive_final" ? "FINALIZE" : data.action });
      return save(run);
    },
  };
}
