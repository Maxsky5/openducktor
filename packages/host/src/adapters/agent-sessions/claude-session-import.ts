import { Effect } from "effect";
import type { AgentSessionSummary } from "@openducktor/core";
import type { HostError } from "../../effect/host-errors";
import type { ClaudeAgentSdkService } from "../../application/runtimes/claude-agent-sdk-service";
import {
  listClaudeSessionMetadata,
  getClaudeSessionMetadata,
} from "../claude/claude-session-metadata";
import { createRuntimeSessionImportAdapter } from "./runtime-session-import-adapter";
export const createClaudeSessionImportAdapter = (
  service: Pick<ClaudeAgentSdkService, "openForImport">,
  runtimeId: string,
  publish: (
    effect: Effect.Effect<AgentSessionSummary, HostError>,
  ) => Effect.Effect<unknown, HostError>,
) =>
  createRuntimeSessionImportAdapter({
    listMetadataPage: ({ signal }) => listClaudeSessionMetadata(signal),
    getMetadata: getClaudeSessionMetadata,
    openForImport: async (input) => {
      const handle = await Effect.runPromise(service.openForImport(input, runtimeId));
      return {
        metadata: handle.metadata,
        selectedModel: handle.selectedModel,
        commit: () => Effect.runPromise(publish(handle.commit)).then(() => undefined),
        dispose: () => Effect.runPromise(handle.dispose),
      };
    },
  });
