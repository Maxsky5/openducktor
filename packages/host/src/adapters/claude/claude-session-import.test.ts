import { expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import { openClaudeSessionForImport } from "./claude-session-import";
import * as native from "./claude-session-metadata";
import { createClaudeAgentSdkSessionStore } from "./claude-agent-sdk-session-store";
import {
  createClaudeSession,
  createClaudeQueryFixture,
} from "./claude-agent-sdk-session-io.test-support";
import type { ClaudeAgentSdkEvent, ClaudeSessionStore } from "./claude-agent-sdk-types";
const ref = {
  repoPath: "/repo",
  runtimeKind: "claude" as const,
  externalSessionId: "native",
  workingDirectory: "/repo",
};
test.each([false, true])(
  "Claude preparation stays private until commit=%s and closes only its own query",
  async (commit) => {
    const inspect = spyOn(native, "getClaudeSessionMetadata").mockResolvedValue({
      ...ref,
      title: "Native title",
      updatedAt: 1,
    });
    const model = spyOn(native, "readClaudeSessionModel").mockResolvedValue({
      runtimeKind: "claude",
      providerId: "claude",
      modelId: "native-claude",
    });
    const store = createClaudeAgentSdkSessionStore();
    let closes = 0;
    const events: ClaudeAgentSdkEvent[] = [];
    let preparedStore: ClaudeSessionStore | undefined;
    try {
      const handle = await Effect.runPromise(
        openClaudeSessionForImport(ref, {
          now: () => "2026-09-20T00:00:00Z",
          sessionStore: store,
          emit: (_session, event) => events.push(event),
          createSession: (input, launch, preparation) =>
            Effect.sync(() => {
              expect(launch.options).toEqual({ resume: "native" });
              expect(launch.title).toBeUndefined();
              expect(launch.resumeInterruptedTurn).toBeUndefined();
              expect(input.model).toBeUndefined();
              const session = createClaudeSession({
                externalSessionId: "native",
                input,
                runtimeId: "runtime",
                query: createClaudeQueryFixture({
                  close: () => {
                    closes++;
                  },
                }),
              });
              session.summary = {
                ...session.summary,
                externalSessionId: "native",
                workingDirectory: "/repo",
                sessionAssociation: { kind: "repository" },
              };
              preparedStore = preparation.store;
              preparation.store.set(session);
              preparation.emit(session, {
                type: "session_idle",
                externalSessionId: "native",
                timestamp: "2026-09-20T00:00:00Z",
              });
              return session.summary;
            }),
        }),
      );
      expect(handle.selectedModel?.modelId).toBe("native-claude");
      expect(store.get("native")).toBeUndefined();
      expect(events).toEqual([]);
      if (commit) {
        await Effect.runPromise(handle.commit);
        expect(store.get("native")).toBeDefined();
        expect(preparedStore?.get("native")).toBe(store.get("native"));
        expect(events).toHaveLength(1);
      }
      await Effect.runPromise(handle.dispose);
      expect(closes).toBe(commit ? 0 : 1);
      if (commit) {
        const session = store.get("native");
        if (session) store.close(session);
      }
    } finally {
      inspect.mockRestore();
      model.mockRestore();
    }
  },
);
