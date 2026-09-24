import type {
  AgentSessionSummary,
  UpdateControlledAgentSessionModelInput,
} from "@openducktor/core";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import { getClaudeSessionMetadata } from "./claude-session-metadata";
import { applyClaudeSessionModel } from "./claude-agent-sdk-session-io";
import type { ClaudeSessionLaunchInput } from "./claude-agent-sdk-session-policy";
import { assertClaudeSessionRef } from "./claude-agent-sdk-session-shape";
import type {
  ClaudeAgentSdkServiceError,
  ClaudeSessionInput,
  ClaudeSessionStore,
} from "./claude-agent-sdk-types";
import { fromPromise } from "./claude-agent-sdk-utils";

export const updateClaudeSessionModel = (
  input: UpdateControlledAgentSessionModelInput,
  dependencies: {
    sessionStore: ClaudeSessionStore;
    attach: (
      input: ClaudeSessionInput,
      launch: ClaudeSessionLaunchInput,
    ) => Effect.Effect<AgentSessionSummary, ClaudeAgentSdkServiceError>;
  },
) =>
  Effect.gen(function* () {
    const cold = !dependencies.sessionStore.get(input.externalSessionId);
    if (cold) {
      yield* fromPromise("claudeRuntime.inspectModelUpdateSession", () =>
        getClaudeSessionMetadata(input),
      );
      yield* dependencies.attach(
        {
          repoPath: input.repoPath,
          runtimeKind: "claude",
          workingDirectory: input.workingDirectory,
          externalSessionId: input.externalSessionId,
          sessionScope: input.sessionScope,
          runtimePolicy: { kind: "claude" },
          systemPrompt: "",
        },
        {
          externalSessionId: input.externalSessionId,
          options: { resume: input.externalSessionId },
          preserveNativeSettings: true,
          startedMessage: "Resumed session",
        },
      );
    }
    return yield* fromPromise("claudeRuntime.updateSessionModel", async () => {
      const session = dependencies.sessionStore.get(input.externalSessionId);
      if (!session)
        throw new HostValidationError({
          field: "externalSessionId",
          message: `Claude session '${input.externalSessionId}' closed before its model could be changed. Reopen the chat and retry.`,
        });
      assertClaudeSessionRef(session, input, "update session model");
      const model =
        input.model && session.model?.profileId !== undefined
          ? { ...input.model, profileId: session.model.profileId }
          : input.model;
      // Cold attachment inherits native settings; local model metadata is not yet known.
      await applyClaudeSessionModel(session, model, cold);
      if (session.modelAfterQueuedTurns !== undefined)
        session.modelAfterQueuedTurns = model ?? null;
      session.summary = { ...session.summary };
    });
  });
