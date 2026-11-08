import { randomUUID } from "node:crypto";
import { z } from "zod";

const text = z.string().trim().min(1).max(2500);
const id = z.string().regex(/^C[1-9][0-9]*$/);
const action = z.enum(["EXPAND", "BRANCH", "CHALLENGE", "VERIFY", "REVISE"]);
export const adaptiveArtifactSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("adaptive_step"), action, summary: text,
    candidate: z.object({ id, strategy: text, answer: text }).optional(),
    affected_candidate_id: id.optional(),
    issue: z.object({
      description: text, state: z.enum(["error", "testable", "stuck", "open"]),
      candidate_id: id,
    }).optional(),
    resolve_issue: z.number().int().min(1).optional(),
    evidence: z.object({
      candidate_id: id, description: text,
      type: z.enum(["model_review", "external_report"]),
    }).optional(),
    progress: z.boolean(),
    proposed_action: z.enum(["EXPAND", "BRANCH", "CHALLENGE", "VERIFY", "REVISE", "FINALIZE"]).optional(),
    rationale: text,
  }).strict(),
  z.object({
    kind: z.literal("adaptive_final"), answer: text,
    selected_candidate_id: id.optional(), unresolved: z.array(text).max(20),
  }).strict(),
]);

const descriptions = {
  EXPAND: "Advance a specific unresolved question or construct the first candidate.",
  BRANCH: "Try a materially different strategy; do not claim independent sampling.",
  CHALLENGE: "Seek a concrete counterexample or a missing assumption. Failure to find one is not proof.",
  VERIFY: "Check a specific claim or constraint and set affected_candidate_id to the checked candidate. Report the actual source or method; the server does not execute it. Resolve the issue only if addressed; otherwise propose REVISE when a change is needed.",
  REVISE: "Repair the affected candidate and reconsider affected conclusions. Submit candidate with the SAME id and its complete replacement answer, plus resolve_issue for the issue addressed. Preserve remaining uncertainties.",
  FINALIZE: "Synthesize the best supported answer and explicitly report unresolved issues and verification limits.",
};
export const budgetSchema = z.object({
  max_steps: z.number().int().min(1).max(20).default(8),
  max_candidates: z.number().int().min(1).max(6).default(3),
  max_revisions: z.number().int().min(0).max(6).default(2),
  max_no_progress: z.number().int().min(1).max(5).default(2),
}).strict();

function pick(run, proposed) {
  if (run.used >= run.budget.max_steps) return ["FINALIZE", "step budget exhausted"];
  if (run.noProgress >= run.budget.max_no_progress) return ["FINALIZE", "no-progress limit reached"];
  const open = run.issues.filter(i => !i.resolved);
  if (open.some(i => i.state === "error") && run.revisions < run.budget.max_revisions)
    return ["REVISE", "reported error requires repair"];
  if (open.some(i => i.state === "error")) return ["FINALIZE", "revision budget exhausted with unresolved error"];
  // Only a targeted check after both issue creation and the latest candidate change counts.
  const needsCheck = open.some(issue => {
    if (issue.state !== "testable") return false;
    const lastChange = run.history.findLast(h => h.candidate?.id === issue.candidate_id)?.step ?? 0;
    return !run.history.some(h => h.action === "VERIFY" &&
      (h.affected_candidate_id ?? h.evidence?.candidate_id) === issue.candidate_id &&
      h.step > Math.max(issue.created_step ?? 0, lastChange));
  });
  if (needsCheck) return ["VERIFY", "reported claim needs a targeted check"];
  if (open.some(i => i.state === "stuck") && run.candidates.length < run.budget.max_candidates)
    return ["BRANCH", "reported path is stuck"];
  if (proposed === "FINALIZE") return ["FINALIZE", "model proposes completion"];
  if (proposed === "REVISE" && run.revisions >= run.budget.max_revisions)
    return ["FINALIZE", "revision budget exhausted"];
  if (proposed === "BRANCH" && run.candidates.length >= run.budget.max_candidates)
    return ["CHALLENGE", "candidate limit reached"];
  return [proposed || (run.candidates.length ? "CHALLENGE" : "EXPAND"), "model proposal or default"];
}

export function createAdaptiveEngine({ store, onEvent = () => {}, ttlMs = 2 * 60 * 60 * 1000 } = {}) {
  if (!store) throw new Error("Adaptive state store required.");
  const save = run => store.save(run);
  function load(id) {
    if (!z.string().uuid().safeParse(id).success) throw new Error("Invalid run ID.");
    const run = store.load(id);
    if (!run) throw new Error("Adaptive run missing.");
    if (Date.now() - run.createdAt > ttlMs) throw new Error("Adaptive run expired.");
    return run;
  }
  function view(run) {
    return {
      run_id: run.id, strategy: "adaptive_search", stage_key: run.stageKey,
      status: run.status, task: run.task, action: run.action, action_reason: run.actionReason,
      budget: { ...run.budget, used_steps: run.used, revisions_used: run.revisions, consecutive_no_progress: run.noProgress },
      candidates: run.candidates, issues: run.issues, evidence: run.evidence,
      history: run.history, final: run.final,
      next_action: run.status === "completed" ? "Return the answer, unresolved issues and run_id." :
        `${descriptions[run.action]} Submit ${run.action === "FINALIZE" ? "kind=adaptive_final" : "kind=adaptive_step with action=" + run.action}. Use concise findings, not private chain-of-thought. Report one concrete issue when relevant, and resolve earlier issues by number only after addressing them. progress and evidence are model-reported.`,
      limitations: "Scheduler signals, progress and evidence are model-reported, not independently verified. This server does not call a model or execute verification. Completed means protocol completion only.",
    };
  }
  return {
    owns(id) { return z.string().uuid().safeParse(id).success && store.owns(id); },
    start({ task, budget, feedback = "none" }) {
      if (!task?.trim() || task.length > 12000) throw new Error("Supply a nonempty task up to 12000 characters.");
      if (feedback !== "none") throw new Error("Adaptive search does not support objective feedback.");
      const run = {
        id: randomUUID(), stageKey: randomUUID(), createdAt: Date.now(), task: task.trim(),
        status: "searching", action: "EXPAND", actionReason: "construct an initial candidate",
        budget: budgetSchema.parse(budget ?? {}), used: 0, revisions: 0, noProgress: 0,
        candidates: [], issues: [], evidence: [], history: [], final: null,
      };
      save(run);
      onEvent({ event: "adaptive_started", run_id: run.id });
      return view(run);
    },
    status(id) { return view(load(id)); },
    submit({ run_id, stage_key, artifact }) {
      const run = load(run_id);
      if (run.status === "completed") return view(run);
      const reject = message => ({ ...view(run), status: "rejected", errors: [message] });
      if (stage_key !== run.stageKey) return reject("Stale stage key; retrieve the current state.");
      const parsed = adaptiveArtifactSchema.safeParse(artifact);
      if (!parsed.success) return reject(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
      const data = parsed.data;
      if (run.action === "FINALIZE") {
        if (data.kind !== "adaptive_final") return reject("Submit an adaptive_final artifact.");
        if (data.selected_candidate_id && !run.candidates.some(c => c.id === data.selected_candidate_id))
          return reject("Selected candidate does not exist.");
        if (run.issues.some(i => !i.resolved) && data.unresolved.length === 0)
          return reject("Report the remaining unresolved issues.");
        run.final = data;
        run.status = "completed";
      } else {
        if (data.kind !== "adaptive_step" || data.action !== run.action) return reject(`Expected adaptive_step action=${run.action}.`);
        const existing = candidateId => run.candidates.some(c => c.id === candidateId);
        if (data.candidate && existing(data.candidate.id) && data.action !== "REVISE") return reject("Candidate ID already exists.");
        if (data.candidate && !existing(data.candidate.id) && run.candidates.length >= run.budget.max_candidates) return reject("Candidate limit reached.");
        if (data.action === "BRANCH" && !data.candidate) return reject("Branch requires a new candidate.");
        if (data.affected_candidate_id && !existing(data.affected_candidate_id)) return reject("Affected candidate does not exist.");
        if (data.issue && !existing(data.issue.candidate_id) && data.issue.candidate_id !== data.candidate?.id)
          return reject("Issue candidate does not exist.");
        if (data.evidence && !existing(data.evidence.candidate_id) && data.evidence.candidate_id !== data.candidate?.id)
          return reject("Evidence candidate does not exist.");
        if (data.resolve_issue && !run.issues.some(i => i.id === data.resolve_issue && !i.resolved))
          return reject("Issue does not exist or is already resolved.");
        if (data.action === "REVISE" && (!data.resolve_issue || !data.candidate ||
            data.candidate.id !== run.issues.find(i => i.id === data.resolve_issue)?.candidate_id))
          return reject("Revision requires the affected candidate as replacement and its resolved issue.");
        if (data.candidate && existing(data.candidate.id)) {
          run.history.push({ replaced_candidate: run.candidates.find(c => c.id === data.candidate.id) });
          for (const evidence of run.evidence) {
            if (evidence.candidate_id === data.candidate.id) evidence.superseded = true;
          }
          run.candidates = run.candidates.map(c => c.id === data.candidate.id ? data.candidate : c);
        } else if (data.candidate) run.candidates.push(data.candidate);
        if (data.resolve_issue) run.issues.find(i => i.id === data.resolve_issue).resolved = true;
        if (data.issue) run.issues.push({
          id: run.issues.length + 1, ...data.issue, created_step: run.used + 1, resolved: false,
        });
        if (data.evidence) run.evidence.push({ ...data.evidence, verification: "unverified_report" });
        run.used++;
        if (data.action === "REVISE") run.revisions++;
        run.noProgress = data.progress ? 0 : run.noProgress + 1;
        run.history.push({ ...data, step: run.used });
        [run.action, run.actionReason] = pick(run, data.proposed_action);
      }
      run.stageKey = randomUUID();
      save(run);
      onEvent({ event: "adaptive_advanced", run_id: run.id, action: data.kind === "adaptive_final" ? "FINALIZE" : data.action });
      return view(run);
    },
  };
}
