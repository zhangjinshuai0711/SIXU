import { z } from "zod";
import { artifactSchema } from "./reasoning.mjs";

const writes = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const response = value => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
export function registerReasoningTools(server, reasoning) {
  server.registerTool("begin_reasoning", {
    description: "Begin a bounded Instant-compatible workflow: plan -> solve 2-4 subproblems -> review -> repair when needed -> synthesize. Supply task for a general question OR case_id for a fixed benchmark. The current chat model supplies each artifact; the server never calls another model. Store concise findings, not private chain-of-thought.",
    inputSchema: {
      task: z.string().max(12000).optional(),
      case_id: z.enum(["sched-01"]).optional(),
      feedback: z.enum(["none", "objective"]).default("none"),
      client_tag: z.string().max(80).optional(),
    },
    annotations: writes,
  }, async args => response(reasoning.start(args)));
  server.registerTool("advance_reasoning", {
    description: "Submit the artifact required by the current phase. Use the latest run_id and stage_key. Follow next_action until completed or stopped. Final conclusions must reconcile every subproblem exactly once as confirmed, revised, or unresolved. Phase completion checks structure; arbitrary semantic correctness is not guaranteed. Max 18 submissions, one subproblem repair cycle, and at most two objective-checked final submissions.",
    inputSchema: { run_id: z.string().uuid(), stage_key: z.string().uuid(), artifact: artifactSchema },
    annotations: writes,
  }, async args => response(reasoning.submit(args)));
  server.registerTool("reasoning_status", {
    description: "Read stored task, current stage and concise intermediate artifacts; or retrieve the completed synthesized answer. Does not advance a run.",
    inputSchema: { run_id: z.string().uuid() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ run_id }) => response(reasoning.status(run_id)));
}
