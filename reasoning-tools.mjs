import { z } from "zod";
import { artifactSchema } from "./reasoning.mjs";
import { adaptiveArtifactSchema, budgetSchema } from "./adaptive-core.mjs";
import { requirementSchema, checkSchema } from "./verification.mjs";

const writes = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const checkKey = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const transportExpression = z.union([
  z.number().finite(),
  z.object({ path: z.array(z.union([z.string(), z.number().int().nonnegative()])).max(8) }).strict(),
  z.object({
    op: z.enum(["add", "subtract", "multiply", "divide"]),
    left: z.unknown(), right: z.unknown(),
  }).strict(),
]).describe('A number, {"path":["total"]}, or {"op":"multiply","left":137,"right":24}. Nested operands use the same form, up to depth 8. Expression strings are unsupported.');
export const transportCheckSchema = z.discriminatedUnion("type", [
  z.object({
    id: checkKey, requirement_id: checkKey, type: z.literal("arithmetic"),
    left: transportExpression, right: transportExpression,
    relation: z.enum(["eq", "le", "ge"]).default("eq"),
  }).strict(),
  ...checkSchema.options.slice(1),
]);
const text = z.string().trim().min(1).max(2500);
const id = z.string().regex(/^C[1-9][0-9]*$/);
const version = z.number().int().positive();
const action = z.enum(["EXPAND", "BRANCH", "CHALLENGE", "VERIFY", "REVISE"]);
const jsonResult = z.record(z.string(), z.unknown());
const choice = {
  selected_candidate_id: id.optional(), selected_candidate_version: version.optional(),
  answer: text.optional(), result: jsonResult.optional(), unresolved: z.array(text).max(64).default([]),
};
export const transportAdaptiveArtifactSchema = z.discriminatedUnion("kind", [
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
      compared_candidate_ids: z.array(id).max(6).default([])
        .describe("IDs of compared alternatives. The reviewed candidate_id is already counted; for C1 compared with C2, [\"C2\"] is sufficient.") }).strict().optional(),
    add_requirements: z.array(requirementSchema).max(64).optional(),
    add_checks: z.array(transportCheckSchema).max(32).optional(),
    finalize: z.object(choice).strict().optional(),
    progress: z.boolean().optional(),
    proposed_action: z.enum(["EXPAND", "BRANCH", "CHALLENGE", "VERIFY", "REVISE", "FINALIZE"]).optional(),
    rationale: text,
  }).strict(),
  z.object({ kind: z.literal("adaptive_final"), ...choice }).strict(),
]);
const response = value => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
  ...(value.status === "rejected" ? { isError: true } : {}),
});
export const conversationInstructions = `Use Sixu Reasoning only for a CURRENT user request explicitly invoking this app (@mention or "use Sixu"). A previous invocation does NOT enable subsequent messages. Answer usage-only questions without a run. The service cannot observe @mentions or enforce host routing.
For each requested task call begin_reasoning with the complete task and necessary relevant context, not the transcript. Default strategy=adaptive_search, depth=medium; explicit "中度"/medium or "深度"/deep selects the corresponding workflow, NOT a different model. auto_upgrade defaults true; user budget overrides remain hard limits. Extract requirements with exact task quotes; declare supported internal checks when useful and model-only requirements otherwise. Arithmetic checks use left/right expression trees, never strings: for 137*24+89 use left={"op":"add","left":{"op":"multiply","left":137,"right":24},"right":89}, right={"path":["total"]}, and candidate.result={"total":3377}. Encode ORIGINAL operands/operators; do not precompute a model answer as the expected constant. The service cannot verify extraction completeness.
Follow next_action and latest stage_key continuously until completed or an actual blocker; honor host approvals. Candidate answers/results are canonical and versioned by the service. Each revision reopens checks; review the current version using review with candidate_id, candidate_version, finding and covered requirement_ids (or legacy evidence with type=model_review if review is unavailable). In deep mode compare the reviewed candidate against at least one other materially different candidate; for candidate_id=C1, compared_candidate_ids=["C2"] suffices (or mention both C1 and C2 in legacy evidence.description). Service checks run automatically on structured result; never execute arbitrary code. Review can include finalize with selected_candidate_id and selected_candidate_version to save a round trip. Omit final answer/result to copy canonical values; revise first if they must change.
Use reasoning_status to recover task/definitions/current state, detail=full only for history. A changed task or explicit follow-up after completion needs a NEW run. Report final.answer/result faithfully with concise basis, unresolved issues, verification limits and actual run_id. The same chat model supplies artifacts; do not invoke another model or paid API. Do not present model/external reports as service-executed checks. Completed means protocol completion, not semantic correctness.`;

export const resolveStrategy = args => args.strategy ?? (args.case_id ? "linear" : "adaptive_search");

export function registerReasoningTools(server, reasoning, adaptive) {
  server.registerTool("begin_reasoning", {
    description: "Begin Sixu for a CURRENT user request explicitly invoking this app. A previous invocation does NOT enable subsequent messages. Default strategy=adaptive_search, depth=medium (or deep when requested). Follow next_action and latest stage_key with advance_reasoning until completed. Supply task OR fixed benchmark case_id (linear only); depth, auto_upgrade, requirements and checks are adaptive-only.",
    inputSchema: {
      task: z.string().max(12000).optional(),
      case_id: z.enum(["sched-01"]).optional(),
      feedback: z.enum(["none", "objective"]).default("none"),
      client_tag: z.string().max(80).optional(),
      strategy: z.enum(["linear", "adaptive_search"]).optional()
        .describe("Omit for adaptive_search with task, or linear with case_id. Explicit choices override these defaults."),
      budget: budgetSchema.optional(),
      depth: z.enum(["medium", "deep"]).optional(),
      auto_upgrade: z.boolean().optional(),
      requirements: z.array(requirementSchema).max(64).optional(),
      checks: z.array(transportCheckSchema).max(32).optional(),
    },
    annotations: writes,
  }, async args => {
    if (resolveStrategy(args) === "adaptive_search") {
      if (args.case_id) throw new Error("Adaptive search requires task, not case_id.");
      return response(adaptive.start(args));
    }
    if (["budget", "depth", "auto_upgrade", "requirements", "checks"].some(name => args[name] !== undefined))
      throw new Error("Budget, depth, auto_upgrade, requirements and checks require adaptive_search.");
    return response(reasoning.start(args));
  });
  server.registerTool("advance_reasoning", {
    description: "Submit the requested artifact with latest stage_key. Continue this explicitly requested task, not future messages. Candidates are versioned; revise first to change an answer. Reviews target the current candidate version (via review or legacy evidence with type=model_review), resolve model issues only, and may include finalize ID/version for same-call completion. Service checks execute on result automatically; model reports are not independent verification.",
    inputSchema: { run_id: z.string().uuid(), stage_key: z.string().uuid(), artifact: z.union([artifactSchema, transportAdaptiveArtifactSchema]) },
    annotations: writes,
  }, async args => response((adaptive.owns(args.run_id) ? adaptive : reasoning).submit(args)));
  server.registerTool("reasoning_status", {
    description: "Read original task, locked definitions, current state and canonical final. detail=full additionally returns complete history/evidence. Legacy adaptive runs are read-only. Does not advance or enable future tasks.",
    inputSchema: { run_id: z.string().uuid(), detail: z.enum(["compact", "full"]).default("compact") },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ run_id, detail }) => response((adaptive.owns(run_id) ? adaptive : reasoning).status(run_id, { detail })));
}
