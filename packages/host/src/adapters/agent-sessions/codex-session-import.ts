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
    scanSessions: async function* (signal) {
      let pageToken: string | undefined;
      const seen = new Set<string>();
      do {
        const request: Parameters<CodexSessionController["listSessionMetadataPage"]>[0] = {
          repoPath,
          runtimeKind: "codex",
          workingDirectory: repoPath,
          externalSessionId: "discovery",
          signal,
        };
        if (pageToken) request.pageToken = pageToken;
        const page = await controller.listSessionMetadataPage(request);
        yield page.sessions;
        if (page.nextPageToken && seen.has(page.nextPageToken))
          throw new Error("Codex repeated a session page. Update Codex and retry.");
        pageToken = page.nextPageToken ?? undefined;
        if (pageToken) seen.add(pageToken);
      } while (pageToken);
    },
    inspectSession: async (input) => {
      const policy = await Effect.runPromise(resolvePolicy({ kind: "repository" }));
      const handle = await controller.openExistingSession({
        ...input,
        runtimeKind: "codex",
        sessionScope: { kind: "repository" },
        runtimePolicy: { kind: "codex", policy },
      });
      return {
        ...handle,
        attach: async () => {
          await handle.attach();
          await Effect.runPromise(publish());
        },
      };
    },
  });
