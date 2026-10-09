import { HostOperationError, HostValidationError } from "../../effect/host-errors";
import type {
  ClaudeAgentSdkEventEmitter,
  ClaudeModelReport,
  ClaudeSession,
  CreateClaudeAgentSdkServiceInput,
} from "./claude-agent-sdk-types";
import { findClaudeModel } from "./claude-model-metadata";
import { reportClaudeSpeedPublicationFailure } from "./claude-session-speed-observation";

export const observeClaudeSessionModel = async (
  session: ClaudeSession,
  report: ClaudeModelReport,
  emit: ClaudeAgentSdkEventEmitter,
  timestamp: string,
  onBackgroundFailure: CreateClaudeAgentSdkServiceInput["onBackgroundFailure"],
): Promise<void> => {
  if (session.abortController.signal.aborted || session.activity === "stopped") return;
  // Keep the latest native model while older reports save.
  session.nativeModel = report;
  if (session.turnAdmission.isHeld) {
    (session.pendingModelReports ??= []).push({ ...report, timestamp });
    return;
  }
  if (!changesModel(session, report)) return;
  const release = await session.turnAdmission.hold();
  try {
    await applyClaudeSessionModelReport(session, report, emit, timestamp, onBackgroundFailure);
  } finally {
    release();
  }
};

/** Apply all held reports before the next queued turn can start. */
export const flushClaudeSessionModelReports = async (
  session: ClaudeSession,
  emit: ClaudeAgentSdkEventEmitter,
  isCurrent: () => boolean,
  onBackgroundFailure: CreateClaudeAgentSdkServiceInput["onBackgroundFailure"],
): Promise<void> => {
  while (session.pendingModelReports?.length) {
    if (!isCurrent()) {
      delete session.pendingModelReports;
      return;
    }
    const report = session.pendingModelReports.shift();
    if (report)
      await applyClaudeSessionModelReport(
        session,
        report,
        emit,
        report.timestamp,
        onBackgroundFailure,
      );
  }
};

/** Runs under native turn admission, after the queued message's model is applied. */
export const prepareClaudeTurnSpeed = async (
  session: ClaudeSession,
  emit: ClaudeAgentSdkEventEmitter,
  timestamp: string,
  persistModel = false,
): Promise<void> => {
  const previous = session.summary.speed;
  if (previous.choice === "standard") return;
  if (previous.choice === null || previous.synchronization !== "confirmed")
    throw new HostValidationError({
      field: "speed",
      message: "Set fast mode explicitly before sending another message.",
    });
  const models = await session.query.supportedModels();
  const model = findClaudeModel(models, session.model?.modelId);
  // A confirmed request permits native standard processing during a reported limit.
  if (model?.supportsFastMode === true) return;
  if (!model)
    throw new HostValidationError({
      field: "speed",
      message:
        "Claude did not report speed support for the queued model. Refresh its model list or turn fast mode off.",
    });
  if (!session.recordSpeedChoice)
    throw new HostValidationError({
      field: "speed",
      message: "Fast-mode persistence is not configured.",
    });
  let publish: () => Promise<void>;
  try {
    await session.query.applyFlagSettings({ fastMode: false });
    publish = await session.recordSpeedChoice("standard", persistModel ? session.model : undefined);
  } catch (cause) {
    try {
      await session.query.applyFlagSettings({ fastMode: true });
    } catch (restoreFailure) {
      session.summary.speed = {
        ...previous,
        synchronization: "uncertain",
        reason: {
          code: "settings_uncertain",
          message: "Claude could not restore fast mode after a failed save.",
          nextAction: "Set fast mode explicitly before sending another message.",
        },
      };
      session.turnAdmission.setBlocked(true);
      throw new HostOperationError({
        operation: "claudeRuntime.prepareTurnSpeed",
        message:
          "Fast-mode reset and restore failed. Set fast mode explicitly before sending another message.",
        cause: { cause, restoreFailure },
      });
    }
    throw cause;
  }
  session.summary.speed = {
    choice: "standard",
    synchronization: "confirmed",
    availability: { status: "available" },
    processing: { status: "off" },
  };
  emit(session, {
    type: "session_speed_changed",
    externalSessionId: session.externalSessionId,
    timestamp,
    observation: {
      reportedChoice: "standard",
      availability: session.summary.speed.availability,
      processing: session.summary.speed.processing,
    },
  });
  await publish();
};

const applyClaudeSessionModelReport = async (
  session: ClaudeSession,
  report: ClaudeModelReport,
  emit: ClaudeAgentSdkEventEmitter,
  timestamp: string,
  onBackgroundFailure: CreateClaudeAgentSdkServiceInput["onBackgroundFailure"],
): Promise<void> => {
  if (!changesModel(session, report)) return;
  session.model = {
    ...session.model,
    providerId: session.model?.providerId ?? "claude",
    modelId: report.modelId,
  };
  if (report.effort === null) delete session.model.variant;
  else if (report.effort !== undefined) session.model.variant = report.effort;
  const previous = session.summary.speed;
  let committed = false;
  try {
    // A model report must reach storage even when speed still needs an explicit choice.
    if (previous.synchronization !== "unapplied") {
      await prepareClaudeTurnSpeed(session, emit, timestamp, true);
      // The reset already commits the model and off choice together.
      if (previous.choice === "fast" && session.summary.speed.choice === "standard") return;
    }
    if (!session.recordSpeedChoice)
      throw new HostValidationError({
        field: "speed",
        message: "Set fast mode explicitly before using the runtime's new model.",
      });
    const publish = await session.recordSpeedChoice(session.summary.speed.choice, session.model);
    committed = true;
    await publish();
  } catch (cause) {
    if (
      committed ||
      (previous.choice === "fast" &&
        session.summary.speed.choice === "standard" &&
        session.summary.speed.synchronization === "confirmed")
    ) {
      await reportClaudeSpeedPublicationFailure(session, cause, onBackgroundFailure);
      return;
    }
    session.summary.speed = {
      ...session.summary.speed,
      synchronization: "unapplied",
      reason: {
        code: "model_reconcile_failed",
        message:
          "Could not confirm fast mode for the runtime's new model. Refresh its model list or set fast mode explicitly.",
      },
    };
    session.turnAdmission.setBlocked(true);
    throw cause;
  }
};

const changesModel = (session: ClaudeSession, report: ClaudeModelReport): boolean =>
  session.model?.modelId !== report.modelId ||
  (report.effort !== undefined && session.model?.variant !== (report.effort ?? undefined));
