import type { AgentSpeedRuntimeObservation } from "@openducktor/contracts";
import { Effect } from "effect";
import type {
  ClaudeAgentSdkService,
  ClaudeSession,
  ClaudeSessionStore,
  CreateClaudeAgentSdkServiceInput,
} from "./claude-agent-sdk-types";
import type { SessionRef } from "@openducktor/core";
import { errorMessage, HostOperationError, HostValidationError } from "../../effect/host-errors";
import {
  type ClaudeSpeedReport,
  claudeSpeedReasons,
  readClaudeSpeedAvailability,
  readClaudeSpeedChoice,
} from "./claude-speed-metadata";

export const observeClaudeSpeed = (
  session: ClaudeSession,
  report: ClaudeSpeedReport,
  reportsSessionChoice: boolean,
): AgentSpeedRuntimeObservation => {
  const state = report.fast_mode_state;
  const reason = report.fast_mode_disabled_reason;
  const observation: AgentSpeedRuntimeObservation = {};
  const availability = readClaudeSpeedAvailability(report, session.summary.speed.choice);
  if (availability) observation.availability = availability;
  if (state === "cooldown")
    observation.processing = {
      status: "cooldown",
    };
  else if (state === "on")
    observation.processing = reportsSessionChoice
      ? { status: "unknown" }
      : { status: "active", level: "fast" };
  else if (state === "off")
    observation.processing =
      session.summary.speed.choice !== null && session.summary.speed.choice !== "standard"
        ? {
            status: "standard",
          }
        : { status: "off" };
  if (
    reason &&
    (observation.processing?.status === "standard" || observation.processing?.status === "cooldown")
  )
    observation.processing.reason = { code: reason, message: claudeSpeedReasons[reason] };
  const reportedChoice = reportsSessionChoice ? readClaudeSpeedChoice(report) : undefined;
  if (reportedChoice !== undefined) observation.reportedChoice = reportedChoice;
  const previous = session.summary.speed;
  session.summary.speed = {
    ...previous,
    availability: observation.availability ?? previous.availability,
    processing: observation.processing ?? previous.processing,
    // Startup resolves imported uncertainty. Saved choices need host confirmation.
    choice: previous.choice === null ? (observation.reportedChoice ?? null) : previous.choice,
  };
  return observation;
};

/** Only an init report describes the session choice; turn results describe processing. */
export const commitClaudeSessionChoiceReport = async (
  session: ClaudeSession,
  report: ClaudeSpeedReport,
  onBackgroundFailure: CreateClaudeAgentSdkServiceInput["onBackgroundFailure"],
): Promise<void> => {
  const previous = session.summary.speed;
  const choice = readClaudeSpeedChoice(report);
  if (
    (previous.synchronization === "unapplied" &&
      (previous.choice !== null || !session.speedInitialized)) ||
    session.turnAdmission.isHeld ||
    choice === undefined
  )
    return;
  if (choice === previous.choice && previous.synchronization === "confirmed") return;
  const release = await session.turnAdmission.hold();
  let committed = false;
  try {
    if (!session.recordSpeedChoice) throw new Error("Fast-mode persistence is not configured.");
    const publish = await session.recordSpeedChoice(
      choice,
      session.preserveNativeSettings && session.nativeModel !== undefined
        ? session.model
        : undefined,
      previous.choice,
    );
    session.summary.speed = { ...previous, choice, synchronization: "confirmed" };
    session.turnAdmission.setBlocked(false);
    committed = true;
    await publish();
  } catch (cause) {
    if (committed) {
      await reportClaudeSpeedPublicationFailure(session, cause, onBackgroundFailure);
      return;
    }
    if (previous.choice !== null && previous.synchronization === "confirmed") {
      try {
        await session.query.applyFlagSettings({ fastMode: previous.choice === "fast" });
        session.summary.speed = previous;
        session.turnAdmission.setBlocked(false);
      } catch (restoreFailure) {
        session.summary.speed = {
          ...previous,
          synchronization: "uncertain",
          reason: {
            code: "settings_uncertain",
            message: "Claude could not save or restore its speed change. Set fast mode explicitly.",
          },
        };
        session.turnAdmission.setBlocked(true);
        throw new HostOperationError({
          operation: "claudeRuntime.observeSpeed",
          message: session.summary.speed.reason!.message,
          cause: { cause, restoreFailure },
        });
      }
    } else {
      session.summary.speed = { ...previous, synchronization: "uncertain" };
      session.turnAdmission.setBlocked(true);
    }
    throw cause;
  } finally {
    release();
  }
};

/** Bind each report to the session that produced it, including across pending store reads. */
export const bindClaudeSpeedWriter = (
  session: ClaudeSession,
  store: ClaudeSessionStore,
  ref: Omit<SessionRef, "externalSessionId">,
  recorder: Parameters<ClaudeAgentSdkService["setSpeedChoiceRecorder"]>[0] | undefined,
): void => {
  session.recordSpeedChoice = (choice, model, previousChoice) => {
    if (!recorder)
      throw new HostValidationError({
        field: "speed",
        message: "Fast-mode persistence is not configured.",
      });
    return recorder(
      { ...ref, externalSessionId: session.externalSessionId },
      choice,
      () =>
        !session.abortController.signal.aborted && store.get(session.externalSessionId) === session,
      model,
      previousChoice,
    );
  };
};

/** A saved native report must not stop the SDK stream when its publication fails. */
export const reportClaudeSpeedPublicationFailure = (
  session: ClaudeSession,
  cause: unknown,
  onBackgroundFailure: CreateClaudeAgentSdkServiceInput["onBackgroundFailure"],
): Promise<void> =>
  Effect.runPromise(
    onBackgroundFailure(
      new HostOperationError({
        operation: "claudeRuntime.publishSpeed",
        message: `Could not publish the saved Claude session settings: ${errorMessage(cause)}. Refresh the session view.`,
        cause,
        details: { externalSessionId: session.externalSessionId },
      }),
    ),
  );
