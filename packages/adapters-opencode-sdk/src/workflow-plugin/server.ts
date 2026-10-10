import type { OpenCodeClient } from "@opencode/client";
import type { OpenCodeRuntimeConnection } from "../types";
import type { Plugin } from "@opencode/plugin/promise/plugin";
import { createOpenCodeClient, operationError } from "../opencode-client";
import { ownedWorkflowRole, readWorkflowInstructions } from "../opencode-permissions";
import { OPENCODE_WORKFLOW_INSTRUCTION_KEY } from "../opencode-session-transcript";
import {
  OPENCODE_WORKFLOW_PLUGIN_ID,
  OPENCODE_WORKFLOW_PLUGIN_RPC,
  openCodeRuntimeConnectionSchema,
} from "../opencode-workflow-plugin";

export default {
  id: OPENCODE_WORKFLOW_PLUGIN_ID,
  async setup(context) {
    let connection: OpenCodeClient | undefined;
    let binding: OpenCodeRuntimeConnection | undefined;
    const client = () => {
      if (!connection)
        throw new Error(
          "The OpenDucktor workflow plugin is not bound. Restart OpenCode from Diagnostics.",
        );
      return connection;
    };
    await context.session.hook("prompt", async ({ sessionID }) => {
      const child = await context.session.get({ sessionID });
      if (!child.parentID) return;
      const role = ownedWorkflowRole(child);
      if (role === null) return;
      const native = client();
      const entries = await native.session.instructions.entry.list({ sessionID });
      if (entries.some((entry) => entry.key === OPENCODE_WORKFLOW_INSTRUCTION_KEY)) {
        await readWorkflowInstructions(native, {
          repoPath: child.location.directory,
          workingDirectory: child.location.directory,
          externalSessionId: child.id,
        });
        return;
      }
      const parent = await context.session.get({ sessionID: child.parentID });
      const identity = {
        repoPath: child.location.directory,
        workingDirectory: child.location.directory,
        externalSessionId: child.id,
      };
      if (
        parent.id !== child.parentID ||
        parent.location.directory !== child.location.directory ||
        ownedWorkflowRole(parent) !== role
      )
        throw operationError(
          identity,
          "inherit workflow instructions",
          "identity_mismatch",
          "The native parent does not have the same workflow owner and directory.",
        );
      const prompt = await readWorkflowInstructions(native, {
        ...identity,
        externalSessionId: parent.id,
      });
      await native.session.instructions.entry.put({
        sessionID: child.id,
        key: OPENCODE_WORKFLOW_INSTRUCTION_KEY,
        value: prompt,
      });
    });
    await context.session.hook("context", async ({ sessionID }) => {
      const child = await context.session.get({ sessionID });
      if (!child.parentID || ownedWorkflowRole(child) === null) return;
      await readWorkflowInstructions(client(), {
        repoPath: child.location.directory,
        workingDirectory: child.location.directory,
        externalSessionId: child.id,
      });
    });
    await context.rpc.register(OPENCODE_WORKFLOW_PLUGIN_RPC, {
      bind: async (input) => {
        const parsed = openCodeRuntimeConnectionSchema.parse(input);
        if (
          binding &&
          (binding.runtimeId !== parsed.runtimeId ||
            binding.endpoint !== parsed.endpoint ||
            binding.authentication.password !== parsed.authentication.password)
        )
          throw new Error(
            "The OpenDucktor workflow plugin is already bound to another runtime. Restart OpenCode from Diagnostics.",
          );
        if (!connection) connection = createOpenCodeClient(parsed);
        binding = parsed;
        return { ready: true };
      },
      ready: async () => {
        client();
        return { ready: true };
      },
    });
  },
} satisfies Plugin;
