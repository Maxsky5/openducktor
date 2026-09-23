import { Effect } from "effect";
import type { AgentSessionSummary } from "@openducktor/core";
import type { HostError } from "../../effect/host-errors";
import type { ClaudeAgentSdkService } from "../../application/runtimes/claude-agent-sdk-service";
import { listClaudeSessionMetadata } from "../claude/claude-session-metadata";
import { createRuntimeSessionImportAdapter } from "./runtime-session-import-adapter";
export const createClaudeSessionImportAdapter = (
  service: Pick<ClaudeAgentSdkService, "inspectSessionForImport">,
  runtimeId: string,
  publish: (
    effect: Effect.Effect<AgentSessionSummary, HostError>,
  ) => Effect.Effect<unknown, HostError>,
) =>
  createRuntimeSessionImportAdapter({
    scanSessions: async function* (signal) {
      yield await listClaudeSessionMetadata(signal);
    },
    inspectSession: async (input) => {
      const handle = await Effect.runPromise(service.inspectSessionForImport(input, runtimeId));
      return {
        metadata: handle.metadata,
        selectedModel: handle.selectedModel,
        attach: () => Effect.runPromise(publish(handle.attach)).then(() => undefined),
      };
    },
  });
