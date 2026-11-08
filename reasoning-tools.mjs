import { z } from "zod";
import { artifactSchema } from "./reasoning.mjs";
import { adaptiveArtifactSchema, budgetSchema } from "./adaptive-core.mjs";

const writes = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const response = value => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
export function registerReasoningTools(server, reasoning, adaptive) {
  server.registerTool("begin_reasoning", {
    description: "Begin a bounded workflow. Default linear preserves the existing plan/solve/review/repair protocol; choose adaptive_search for candidate-based actions. Supply task OR fixed benchmark case_id (linear only). The current chat model supplies concise artifacts; server never calls another model.",
    inputSchema: {
      task: z.string().max(12000).optional(),
      case_id: z.enum(["sched-01"]).optional(),
      feedback: z.enum(["none", "objective"]).default("none"),
      client_tag: z.string().max(80).optional(),
      strategy: z.enum(["linear", "adaptive_search"]).default("linear"),
      budget: budgetSchema.optional(),
    },
    annotations: writes,
  }, async args => {
    if (args.strategy === "adaptive_search") {
      if (args.case_id) throw new Error("Adaptive search requires task, not case_id.");
      return response(adaptive.start(args));
    }
    if (args.budget) throw new Error("Custom budget is supported only for adaptive_search.");
    return response(reasoning.start(args));
  });
  server.registerTool("advance_reasoning", {
    description: "Submit the artifact requested by next_action using the latest stage_key. Continue until completed or stopped. Adaptive signals and evidence are model-reported; structure and protocol completion do not establish semantic correctness.",
    inputSchema: { run_id: z.string().uuid(), stage_key: z.string().uuid(), artifact: z.union([artifactSchema, adaptiveArtifactSchema]) },
    annotations: writes,
  }, async args => response((adaptive.owns(args.run_id) ? adaptive : reasoning).submit(args)));
  server.registerTool("reasoning_status", {
    description: "Read stored task, current stage and concise intermediate artifacts; or retrieve the completed synthesized answer. Does not advance a run.",
    inputSchema: { run_id: z.string().uuid() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ run_id }) => response((adaptive.owns(run_id) ? adaptive : reasoning).status(run_id)));
}
