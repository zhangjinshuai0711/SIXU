import { z } from "zod";
import { artifactSchema } from "./reasoning.mjs";
import { adaptiveArtifactSchema, budgetSchema } from "./adaptive-core.mjs";

const writes = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const response = value => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
export const conversationInstructions = `Use Sixu Reasoning when the user explicitly selects or @mentions this app for reasoning. Treat that as a request to use it by default for subsequent substantive tasks in THIS chat until the user says "关闭思序" or otherwise disables it. Respect later user instructions and explicit strategy choices. "这次直接回答" skips tools for that turn only; it does not disable later use. Do not carry this preference across chats or users. If the message only enables/disables the app or asks about its usage, acknowledge or answer without creating a reasoning run.
For each new task, call begin_reasoning with the complete task and necessary relevant context, not the whole transcript. The default for a task is adaptive_search with feedback=none. Follow next_action and the latest stage_key using advance_reasoning until completed or stopped; do not wait for the user to prompt each stage. Honor host approvals and limits. While a run is active, use reasoning_status to recover its state. A changed task or a follow-up after completion needs a NEW run incorporating relevant prior conclusions and the new conditions; never submit to a completed run.
The service receives tool requests, not chat messages or @mention events, and stores no chat-level enabled flag. Do not claim guaranteed automatic interception. Report tool errors and incomplete runs honestly; never fabricate a run_id or completion. Give the final answer, concise basis, unresolved issues, verification limits and run_id. The same chat model supplies the artifacts; do not invoke another model or paid API. Protocol completion is not independent verification of correctness.`;

export const resolveStrategy = args => args.strategy ?? (args.case_id ? "linear" : "adaptive_search");

export function registerReasoningTools(server, reasoning, adaptive) {
  server.registerTool("begin_reasoning", {
    description: `Begin a bounded reasoning workflow. ${conversationInstructions} Supply task OR fixed benchmark case_id (linear only). Choose strategy=linear explicitly for the original plan/solve/review/repair workflow.`,
    inputSchema: {
      task: z.string().max(12000).optional(),
      case_id: z.enum(["sched-01"]).optional(),
      feedback: z.enum(["none", "objective"]).default("none"),
      client_tag: z.string().max(80).optional(),
      strategy: z.enum(["linear", "adaptive_search"]).optional()
        .describe("Omit for adaptive_search with task, or linear with case_id. Explicit choices override these defaults."),
      budget: budgetSchema.optional(),
    },
    annotations: writes,
  }, async args => {
    if (resolveStrategy(args) === "adaptive_search") {
      if (args.case_id) throw new Error("Adaptive search requires task, not case_id.");
      return response(adaptive.start(args));
    }
    if (args.budget) throw new Error("Custom budget is supported only for adaptive_search.");
    return response(reasoning.start(args));
  });
  server.registerTool("advance_reasoning", {
    description: "Submit the artifact requested by next_action using the latest stage_key. Continue until completed or stopped without asking the user to prompt each stage. Never advance a completed run: start a new run for a subsequent task. After completion keep the current-chat default unless the user disables it; a one-turn skip does not disable future use. Adaptive signals and evidence are model-reported; structure and protocol completion do not establish semantic correctness.",
    inputSchema: { run_id: z.string().uuid(), stage_key: z.string().uuid(), artifact: z.union([artifactSchema, adaptiveArtifactSchema]) },
    annotations: writes,
  }, async args => response((adaptive.owns(args.run_id) ? adaptive : reasoning).submit(args)));
  server.registerTool("reasoning_status", {
    description: "Read stored task, current stage and concise intermediate artifacts; or retrieve the completed synthesized answer. Does not advance a run.",
    inputSchema: { run_id: z.string().uuid() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ run_id }) => response((adaptive.owns(run_id) ? adaptive : reasoning).status(run_id)));
}
