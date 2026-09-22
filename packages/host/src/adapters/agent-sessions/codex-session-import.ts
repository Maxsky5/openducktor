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
    listMetadataPage: (input) =>
      controller.listSessionMetadataPage({
        ...input,
        repoPath,
        runtimeKind: "codex",
        workingDirectory: repoPath,
        externalSessionId: "discovery",
      }),
    getMetadata: (input) => controller.getSessionMetadata(input),
    openForImport: async (input) => {
      const policy = await Effect.runPromise(resolvePolicy({ kind: "repository" }));
      const handle = await controller.openExistingSession({
        ...input,
        runtimeKind: "codex",
        sessionScope: { kind: "repository" },
        runtimePolicy: { kind: "codex", policy },
      });
      return {
        ...handle,
        commit: async () => {
          await handle.commit();
          await Effect.runPromise(publish());
        },
      };
    },
  });
