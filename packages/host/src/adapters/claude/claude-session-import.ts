import type { AgentSessionSummary, SessionRef } from "@openducktor/core";
import { Effect } from "effect";
import type { ClaudeAgentSdkServiceError } from "./claude-agent-sdk-types";
import { getClaudeSessionMetadata, readClaudeSessionModel } from "./claude-session-metadata";
import { createClaudeAgentSdkSessionStore } from "./claude-agent-sdk-session-store";
import type { ClaudeSessionLaunchInput } from "./claude-agent-sdk-session-policy";
import type {
  ClaudeAgentSdkEvent,
  ClaudeSessionContext,
  ClaudeSessionInput,
  ClaudeSessionStore,
} from "./claude-agent-sdk-types";
import { fromPromise } from "./claude-agent-sdk-utils";
export type ClaudeSessionImportContext = {
  store: ClaudeSessionStore;
  emit: (session: ClaudeSessionContext, event: ClaudeAgentSdkEvent) => void;
};
export const openClaudeSessionForImport = (
  input: SessionRef,
  dependencies: {
    now: () => string;
    sessionStore: ClaudeSessionStore;
    emit: ClaudeSessionImportContext["emit"];
    createSession: (
      input: ClaudeSessionInput,
      launch: ClaudeSessionLaunchInput,
      preparation: ClaudeSessionImportContext,
    ) => Effect.Effect<AgentSessionSummary, ClaudeAgentSdkServiceError>;
  },
) => {
  return Effect.gen(function* () {
    const metadata = yield* fromPromise("claudeRuntime.getSessionMetadata", () =>
      getClaudeSessionMetadata(input),
    );
    const selectedModel = yield* fromPromise("claudeRuntime.readSessionModel", () =>
      readClaudeSessionModel(input),
    );
    const privateStore = createClaudeAgentSdkSessionStore({ now: dependencies.now });
    const events: Array<{ session: ClaudeSessionContext; event: ClaudeAgentSdkEvent }> = [];
    let committed = false;
    const emit = (session: ClaudeSessionContext, event: ClaudeAgentSdkEvent) => {
      if (committed) dependencies.emit(session, event);
      else events.push({ session, event });
    };
    const preparationStore: ClaudeSessionStore = {
      ...privateStore,
      get: (id) => (committed ? dependencies.sessionStore.get(id) : privateStore.get(id)),
      set: (session) =>
        committed ? dependencies.sessionStore.set(session) : privateStore.set(session),
      close: (session) => {
        if (committed) dependencies.sessionStore.close(session);
        else privateStore.close(session);
      },
    };
    const launch: ClaudeSessionLaunchInput = {
      externalSessionId: input.externalSessionId,
      options: { resume: input.externalSessionId },
      startedMessage: "Imported session",
    };
    const summary = yield* dependencies.createSession(
      {
        ...input,
        runtimeKind: "claude",
        sessionScope: { kind: "repository" },
        runtimePolicy: { kind: "claude" },
        systemPrompt: "",
      },
      launch,
      { store: preparationStore, emit },
    );
    return {
      metadata,
      selectedModel,
      registerLiveSession: fromPromise("claudeRuntime.registerLiveSession", async () => {
        const session = privateStore.get(input.externalSessionId);
        if (!session)
          throw new Error(
            "Claude conversation closed before import completed. Open the saved chat to retry.",
          );
        dependencies.sessionStore.set(session);
        privateStore.sessions.delete(session.externalSessionId);
        committed = true;
        for (const buffered of events.splice(0))
          dependencies.emit(buffered.session, buffered.event);
        return summary;
      }),
      releaseImportResources: fromPromise("claudeRuntime.releaseImportResources", async () => {
        if (committed) return;
        const session = privateStore.get(input.externalSessionId);
        if (session) {
          privateStore.close(session);
          await session.query.return();
        }
        events.length = 0;
      }),
    };
  });
};
