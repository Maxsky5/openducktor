import { Effect } from "effect";
import type { HostError } from "../../effect/host-errors";
import type {
  CodexSessionController,
  CreateCodexLiveSessionAdapterPreparerInput,
} from "./codex-live-session-adapter-contract";
import { createExternalRuntimeSessionsAdapter } from "./external-runtime-sessions-adapter";
export const createCodexExternalRuntimeSessions = (
  controller: CodexSessionController,
  repoPath: string,
  resolvePolicy: CreateCodexLiveSessionAdapterPreparerInput["resolveRuntimePolicy"],
  publish: () => Effect.Effect<void, HostError>,
) =>
  createExternalRuntimeSessionsAdapter({
    list: (input) =>
      controller.listExternalSessions({
        ...input,
        repoPath,
        runtimeKind: "codex",
        workingDirectory: repoPath,
        externalSessionId: "discovery",
      }),
    inspect: (input) => controller.inspectExternalSession(input),
    prepare: async (input) => {
      const policy = await Effect.runPromise(resolvePolicy({ kind: "repository" }));
      const handle = await controller.prepareExternalSession({
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
