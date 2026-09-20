import { Effect } from "effect";
import type { AgentSessionSummary } from "@openducktor/core";
import type { HostError } from "../../effect/host-errors";
import type { ClaudeAgentSdkService } from "../../application/runtimes/claude-agent-sdk-service";
import {
  listClaudeExternalSessions,
  inspectClaudeExternalSession,
} from "../claude/claude-external-sessions";
import { createExternalRuntimeSessionsAdapter } from "./external-runtime-sessions-adapter";
export const createClaudeExternalRuntimeSessions = (
  service: Pick<ClaudeAgentSdkService, "prepareExternalSession">,
  runtimeId: string,
  publish: (
    effect: Effect.Effect<AgentSessionSummary, HostError>,
  ) => Effect.Effect<unknown, HostError>,
) =>
  createExternalRuntimeSessionsAdapter({
    list: ({ signal }) => listClaudeExternalSessions(signal),
    inspect: inspectClaudeExternalSession,
    prepare: async (input) => {
      const handle = await Effect.runPromise(service.prepareExternalSession(input, runtimeId));
      return {
        metadata: handle.metadata,
        selectedModel: handle.selectedModel,
        commit: () => Effect.runPromise(publish(handle.commit)).then(() => undefined),
        dispose: () => Effect.runPromise(handle.dispose),
      };
    },
  });
