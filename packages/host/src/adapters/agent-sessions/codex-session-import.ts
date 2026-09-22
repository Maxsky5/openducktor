import { Effect } from "effect";
import type { HostError } from "../../effect/host-errors";
import type {
  CodexSessionController,
  CreateCodexLiveSessionAdapterPreparerInput,
} from "./codex-live-session-adapter-contract";
import { createRuntimeSessionImportAdapter } from "./runtime-session-import-adapter";
export const createCodexSessionImportAdapter = (
  controller: CodexSessionController,
  repoPath: string,
  resolvePolicy: CreateCodexLiveSessionAdapterPreparerInput["resolveRuntimePolicy"],
  publish: () => Effect.Effect<void, HostError>,
) =>
  createRuntimeSessionImportAdapter({
    listRootSessionMetadataPage: (input) =>
      controller.listSessionMetadataPage({
        ...input,
        repoPath,
        runtimeKind: "codex",
        workingDirectory: repoPath,
        externalSessionId: "discovery",
      }),
    openExistingSessionForImport: async (input) => {
      const policy = await Effect.runPromise(resolvePolicy({ kind: "repository" }));
      const handle = await controller.openExistingSession({
        ...input,
        runtimeKind: "codex",
        sessionScope: { kind: "repository" },
        runtimePolicy: { kind: "codex", policy },
      });
      return {
        ...handle,
        registerLiveSession: async () => {
          await handle.registerLiveSession();
          await Effect.runPromise(publish());
        },
      };
    },
  });
