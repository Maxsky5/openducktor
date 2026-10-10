import { z } from "zod";
import { createOpenCodeClient } from "./opencode-client";
import type { OpenCodeRuntimeConnection } from "./types";

export const OPENCODE_WORKFLOW_PLUGIN_ID = "openducktor-workflow-instructions";

export const openCodeRuntimeConnectionSchema = z.strictObject({
  runtimeId: z.string().min(1),
  endpoint: z.string().url(),
  authentication: z.strictObject({
    type: z.literal("basic"),
    username: z.literal("opencode"),
    password: z.string().min(1),
  }),
});

const readyOutput = {
  type: "object",
  properties: { ready: { const: true } },
  required: ["ready"],
  additionalProperties: false,
} as const;

export const OPENCODE_WORKFLOW_PLUGIN_RPC = {
  id: OPENCODE_WORKFLOW_PLUGIN_ID,
  methods: {
    bind: { input: z.toJSONSchema(openCodeRuntimeConnectionSchema), output: readyOutput },
    ready: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: readyOutput,
    },
  },
  events: {},
} as const;

/** The host binds the plugin in memory before exposing the runtime to sessions. */
export const bindOpenCodeWorkflowPlugin = async (
  connection: OpenCodeRuntimeConnection,
  signal?: AbortSignal,
): Promise<void> => {
  const result = await createOpenCodeClient(connection, signal)
    .rpc(OPENCODE_WORKFLOW_PLUGIN_RPC)
    .bind(connection);
  z.object({ ready: z.literal(true) }).parse(result);
};
