import type { SessionRef, AgentSessionSummary } from "@openducktor/core";
import type {
  AgentSessionControlUpdateSpeedInput,
  AgentSessionSpeedState,
} from "@openducktor/contracts";
import { Effect, Exit } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { AgentSessionSettingsRef } from "../../ports/agent-session-live-adapter-port";
import { findClaudeModel } from "./claude-model-metadata";
import { assertClaudeSessionRef } from "./claude-agent-sdk-session-shape";
import { flushQueuedClaudeUserMessage } from "./claude-agent-sdk-session-dispatch";
import { flushClaudeSessionModelReports } from "./claude-session-speed-preparation";
import { claudeSessionRef, fromPromise } from "./claude-agent-sdk-utils";
import type {
  ClaudeAgentSdkServiceError,
  ClaudeSession,
  ClaudeSessionInput,
  ClaudeAgentSdkEventEmitter,
  CreateClaudeAgentSdkServiceInput,
} from "./claude-agent-sdk-types";
import type { ClaudeSessionLaunchInput } from "./claude-agent-sdk-session-policy";

export class ClaudeSessionSpeedControl {
  constructor(
    private readonly context: {
      findSession(id: string): ClaudeSession | undefined;
      requireSession(id: string): ClaudeSession;
      createSession(
        input: ClaudeSessionInput,
        runtimeId: string,
        launch: ClaudeSessionLaunchInput,
      ): Effect.Effect<AgentSessionSummary, ClaudeAgentSdkServiceError>;
      now: () => string;
      emit: ClaudeAgentSdkEventEmitter;
      onBackgroundFailure: CreateClaudeAgentSdkServiceInput["onBackgroundFailure"];
    },
  ) {}
  holdSessionTurns(input: AgentSessionSettingsRef, runtimeId: string) {
    return Effect.gen({ self: this }, function* () {
      if (!this.context.findSession(input.externalSessionId)) {
        yield* this.context.createSession(
          {
            ...input,
            runtimeKind: "claude",
            model: input.model ?? undefined,
            speed: null,
            runtimePolicy: { kind: "claude" },
            systemPrompt: "",
          },
          runtimeId,
          {
            externalSessionId: input.externalSessionId,
            options: { resume: input.externalSessionId },
            preserveNativeSettings: true,
            startedMessage: "Resumed session",
          },
        );
      }
      const session = this.context.requireSession(input.externalSessionId);
      assertClaudeSessionRef(session, input, "hold next turn admission");
      const admission = session.turnAdmission;
      const release = yield* fromPromise("claudeRuntime.holdSessionTurns", () => admission.hold());
      return this.releaseSessionTurns(session, release);
    });
  }

  setSessionSpeedState(input: SessionRef, state: AgentSessionSpeedState) {
    return fromPromise("claudeRuntime.confirmSpeed", async () => {
      const session = this.context.requireSession(input.externalSessionId);
      assertClaudeSessionRef(session, input, "confirm fast mode");
      session.summary.speed = state;
      session.turnAdmission.setBlocked(
        state.synchronization !== "confirmed" || state.choice === null,
      );
    });
  }

  updateSessionSpeed(
    input: AgentSessionControlUpdateSpeedInput,
    retainedState?: AgentSessionSpeedState,
  ) {
    return fromPromise("claudeRuntime.updateSpeed", async () => {
      const session = this.context.requireSession(input.externalSessionId);
      assertClaudeSessionRef(session, input, "change fast mode");
      if (input.speed !== "standard" && input.speed !== "fast")
        throw new HostValidationError({
          field: "speed",
          message: "Claude does not support this speed level.",
        });
      if (input.speed === "fast") {
        const models = await session.query.supportedModels();
        if (findClaudeModel(models, session.model?.modelId)?.supportsFastMode !== true)
          throw new HostValidationError({
            field: "speed",
            message:
              "The selected Claude model does not report speed support. Select a supported model or disable fast mode.",
          });
        // Supported model and effort changes preserve an established session flag.
        if (retainedState?.choice === "fast" && retainedState.synchronization === "confirmed")
          return {
            reportedChoice: "fast",
            availability: retainedState.availability,
            processing: retainedState.processing,
          };
        if (session.summary.speed.availability.status === "blocked")
          throw new HostValidationError({
            field: "speed",
            message: session.summary.speed.availability.reason.message,
          });
      }
      await session.query.applyFlagSettings({ fastMode: input.speed === "fast" });
      return {
        reportedChoice: input.speed,
        availability:
          input.speed === "standard" &&
          session.summary.speed.availability.status === "blocked" &&
          (session.summary.speed.availability.reason.code === "preference" ||
            session.summary.speed.availability.reason.code === "sdk_opt_in_required")
            ? { status: "available" as const }
            : session.summary.speed.availability,
        processing: { status: input.speed === "fast" ? ("unknown" as const) : ("off" as const) },
      };
    });
  }

  restoreSpeed(session: ClaudeSession, choice: string | null | undefined) {
    if (
      session.summary.speed.synchronization === "uncertain" ||
      (choice === null && session.summary.speed.choice === null)
    )
      return Effect.fail(
        new HostValidationError({
          field: "speed",
          message: "Set fast mode explicitly before sending another message.",
        }),
      );
    if (choice === null) return Effect.void;
    const selected = choice ?? "standard";
    if (
      session.summary.speed.synchronization === "confirmed" &&
      session.summary.speed.choice === selected
    )
      return Effect.void;
    const ref = claudeSessionRef(session);
    const restore = this.updateSessionSpeed({
      ...ref,
      speed: selected,
      sessionScope: session.input.sessionScope,
    }).pipe(
      Effect.flatMap((observation) =>
        this.setSessionSpeedState(ref, {
          choice: selected,
          synchronization: "confirmed",
          availability: observation.availability,
          processing: observation.processing,
        }),
      ),
      Effect.tapError(() =>
        this.setSessionSpeedState(ref, {
          ...session.summary.speed,
          choice: selected,
          synchronization: "unapplied",
        }),
      ),
    );
    return Effect.gen({ self: this }, function* () {
      const admission = session.turnAdmission;
      const release = yield* fromPromise("claudeRuntime.holdRestore", () => admission.hold());
      const result = yield* Effect.exit(restore);
      yield* this.releaseSessionTurns(session, release);
      return Exit.isFailure(result) ? yield* Effect.failCause(result.cause) : result.value;
    });
  }

  private releaseSessionTurns(session: ClaudeSession, release: () => void) {
    return fromPromise("claudeRuntime.releaseSessionTurns", async () => {
      const isCurrent = () =>
        this.context.findSession(session.externalSessionId) === session &&
        !session.abortController.signal.aborted &&
        session.activity !== "stopped";
      try {
        await flushClaudeSessionModelReports(
          session,
          this.context.emit,
          isCurrent,
          this.context.onBackgroundFailure,
        );
      } finally {
        release();
      }
      if (isCurrent())
        await flushQueuedClaudeUserMessage({
          session,
          now: this.context.now,
          emit: this.context.emit,
        });
    });
  }
}
