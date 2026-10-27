import { agentWorkflowStateSchema, taskCardSchema } from "@openducktor/contracts";
import { z } from "zod";
import {
  BUILTIN_ACTION_IDS,
  BUILTIN_ISSUE_TYPE_IDS,
  BUILTIN_ROLE_IDS,
  BUILTIN_STATE_IDS,
} from "./ids";

/** A task card of the built-in workflow. A client checks host task cards with it once. */
export const builtinTaskCardSchema = taskCardSchema.extend({
  status: z.enum(BUILTIN_STATE_IDS),
  issueType: z.enum(BUILTIN_ISSUE_TYPE_IDS),
  availableActions: z.array(z.enum(BUILTIN_ACTION_IDS)),
  agentWorkflows: z.record(z.enum(BUILTIN_ROLE_IDS), agentWorkflowStateSchema),
});
export type BuiltinTaskCard = z.infer<typeof builtinTaskCardSchema>;
