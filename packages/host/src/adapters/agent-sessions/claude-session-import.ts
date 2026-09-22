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
  service: Pick<ClaudeAgentSdkService, "openExistingSessionForImport">,
  runtimeId: string,
  publish: (
    effect: Effect.Effect<AgentSessionSummary, HostError>,
  ) => Effect.Effect<unknown, HostError>,
) =>
  createRuntimeSessionImportAdapter({
    listRootSessionMetadataPage: ({ signal }) => listClaudeSessionMetadata(signal),
    verifyImportSource: getClaudeSessionMetadata,
    openExistingSessionForImport: async (input) => {
      const handle = await Effect.runPromise(
        service.openExistingSessionForImport(input, runtimeId),
      );
      return {
        metadata: handle.metadata,
        selectedModel: handle.selectedModel,
        registerLiveSession: () =>
          Effect.runPromise(publish(handle.registerLiveSession)).then(() => undefined),
        releaseImportResources: () => Effect.runPromise(handle.releaseImportResources),
      };
    },
  });
