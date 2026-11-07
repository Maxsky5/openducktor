import {
  type AutopilotOutcome,
  type AutopilotRecoveryClaimInput,
  type AutopilotRecoveryClaimResult,
  type AutopilotRunEvent,
  type AutopilotState,
  type AutopilotStateReadInput,
  jsonValuesEqual,
  type NotificationActionOccurrence,
  type WorkflowLaunchResult,
} from "@openducktor/contracts";
import {
  buildSessionStartErrorOccurrence,
  buildSessionStartedOccurrence,
  sessionLaunchFailureMessage,
} from "@openducktor/core";
import { Cause, Effect, Exit, FiberSet, type Result, Scope } from "effect";
import {
  causeMessages,
  errorMessage,
  type HostError,
  HostOperationError,
  type HostOperationErrorAggregate,
  toHostOperationError,
} from "../../effect/host-errors";
import type { SettingsConfigView, SettingsConfigPort } from "../../ports/settings-config-port";
import type { TaskWorkflow } from "@openducktor/workflows";
import type { TaskWorkflowResolver } from "../../ports/task-workflow-port";
import type { TaskService } from "../tasks/task-service";
import type {
  AutomaticWorkflowLaunchStartCheck,
  WorkflowLaunchService,
} from "../agent-sessions/workflow-launch-types";
import type { NotificationService } from "../notifications/notification-service";
import type { TaskSyncService } from "../tasks/sync/task-sync-service";
import type { CommittedTaskStatusChange } from "../tasks/task-mutation-operation";
import { createAutopilotWorkspaceViews } from "./autopilot-workspace-views";

/** One automatic action for one qualifying committed change. */
type Attempt = {
  outcomeId: string;
  workspaceId: string;
  repoPath: string;
  /** The workspace path and name that the committed change read, for its notification. */
  notificationTarget: { workspaceId: string; repoPath: string; repositoryLabel: string };
  generation: number;
  sequence: number;
  /** The exact workflow of the committed change. */
  workflow: TaskWorkflow;
  /** The mutation gate key of the mutation that committed the change. */
  gateKey: string;
  task: { id: string; title: string };
  eventId: string;
  actionId: string;
};

type HeldOutcome = { outcome: AutopilotOutcome; recoveryClaimed: boolean };

export type AutopilotServiceDependencies = {
  settingsConfig: SettingsConfigPort;
  taskWorkflows: TaskWorkflowResolver;
  tasks: Pick<TaskService, "listTaskIds">;
  mutations: Pick<TaskSyncService, "runMutation">;
  workflowLaunch: Pick<WorkflowLaunchService, "launch">;
  notifications: Pick<NotificationService, "publishAction">;
  /** Sends an event to every attached client. */
  publish: (event: AutopilotRunEvent) => void;
  onBackgroundFailure: (failure: HostOperationErrorAggregate) => Effect.Effect<void>;
};

const skip = (reason: string) => ({ start: false as const, reason });

/**
 * Runs Autopilot for every open workspace. It reacts to committed task status changes, uses the
 * saved rules, and starts each qualifying action at most once through the workflow launch
 * service. All state stays in memory, so a host restart loses waiting attempts and outcomes.
 */
export const createAutopilotService = (deps: AutopilotServiceDependencies) => {
  let phase: "pending" | "ready" | "stopped" = "pending";
  /** The settings read at initialization or the latest save from this host. */
  let config: SettingsConfigView | null = null;
  let failure: string | null = null;
  let lastSequence = 0;
  const latestChanges = new Map<string, Map<string, { sequence: number; status: string }>>();
  /** The latest outcome of each task and action, by workspace. */
  const outcomes = new Map<string, Map<string, HeldOutcome>>();
  // Holds the waiting and running attempts. Dispose closes the scope, which interrupts them.
  const attemptsScope = Scope.makeUnsafe();
  const attempts = Effect.runSync(Scope.provide(FiberSet.make<void>(), attemptsScope));

  const reportFailure = (message: string | null): void => {
    failure = message;
    deps.publish({ type: "autopilot_failure", failure: message });
  };

  // A waiting attempt of a removed workspace skips at its start check, and settle drops it.
  const forgetWorkspace = (workspaceId: string): void => {
    latestChanges.delete(workspaceId);
    outcomes.delete(workspaceId);
  };

  const workspaces = createAutopilotWorkspaceViews(forgetWorkspace);

  const workspaceSkip = (attempt: Attempt) => {
    const workspace = workspaces.get(attempt.workspaceId);
    if (!workspace || workspace.state === "removing")
      return skip("The workspace was removed before the action started.");
    if (workspace.state === "closed" || workspace.generation !== attempt.generation)
      return skip("The workspace closed before the action started.");
    return null;
  };

  const startCheck = (attempt: Attempt): AutomaticWorkflowLaunchStartCheck =>
    Effect.gen(function* () {
      const closed = workspaceSkip(attempt);
      if (closed) return closed;
      const taskIds = yield* deps.tasks
        .listTaskIds({ workspaceId: attempt.workspaceId, repoPath: attempt.repoPath })
        .pipe(Effect.mapError((cause) => toHostOperationError(cause, "autopilot.start-check")));
      const closedDuringRead = workspaceSkip(attempt);
      if (closedDuringRead) return closedDuringRead;
      if (!taskIds.includes(attempt.task.id))
        return skip("The task was deleted before the action started.");
      // The rules are read last, so a save that commits during the earlier reads disables them.
      const settings = yield* deps.settingsConfig.readAutopilotSettings().pipe(
        Effect.mapError(
          (cause) =>
            new HostOperationError({
              operation: "autopilot.start-check",
              message: `Autopilot could not read the application settings: ${errorMessage(cause)} Correct the application settings, then start the action manually.`,
              cause,
            }),
        ),
      );
      const closedDuringSettingsRead = workspaceSkip(attempt);
      if (closedDuringSettingsRead) return closedDuringSettingsRead;
      const rule = settings.rules.find(
        (rule) =>
          rule.workflowId === attempt.workflow.reference.id && rule.eventId === attempt.eventId,
      );
      if (!rule?.actionIds.includes(attempt.actionId))
        return skip("The Autopilot rule was disabled before the action started.");
      const latest = latestChanges.get(attempt.workspaceId)?.get(attempt.task.id);
      if (latest && latest.sequence !== attempt.sequence) {
        const state = attempt.workflow.state(latest.status);
        return skip(`The task moved to ${state.title ?? state.label} before the action started.`);
      }
      return { start: true as const };
    });

  const toOutcome = (
    attempt: Attempt,
    result: Result.Result<WorkflowLaunchResult, HostError>,
  ): AutopilotOutcome => {
    const fields = {
      outcomeId: attempt.outcomeId,
      workspaceId: attempt.workspaceId,
      repoPath: attempt.repoPath,
      task: attempt.task,
      workflowId: attempt.workflow.reference.id,
      eventId: attempt.eventId,
      actionId: attempt.actionId,
      actionLabel: attempt.workflow.automation(attempt.actionId).label,
      occurredAt: new Date().toISOString(),
    };
    // A launch can report an empty text, but clients accept an outcome only with text.
    if (result._tag === "Failure")
      return {
        ...fields,
        kind: "failed",
        message: errorMessage(result.failure) || "The launch failed.",
      };
    const launch = result.success;
    if (launch.status === "completed") return { ...fields, kind: "started", launch };
    if (launch.status === "skipped")
      return { ...fields, kind: "skipped", reason: launch.skipReason || "The launch was skipped." };
    return {
      ...fields,
      kind: "failed",
      message: launch.failure
        ? sessionLaunchFailureMessage(launch.failure) || "The launch failed."
        : "The launch was canceled.",
      launch,
    };
  };

  /** Returns the id of a published error notification, so clients can skip its in-app toast. */
  const notify = (attempt: Attempt, outcome: AutopilotOutcome): Effect.Effect<string | null> =>
    Effect.gen(function* () {
      const target = attempt.notificationTarget;
      // The launch names the role of the session that it used. A launch that failed before it
      // ran names the first candidate role of the automation.
      const launch = outcome.kind === "skipped" ? undefined : outcome.launch;
      const role = launch?.role ?? attempt.workflow.automation(outcome.actionId).roles[0]!;
      const input = {
        launchAttemptId: outcome.outcomeId,
        taskId: outcome.task.id,
        taskTitle: outcome.task.title,
        role,
        roleLabel: attempt.workflow.role(role).label,
      };
      let occurrence: NotificationActionOccurrence | null = null;
      if (outcome.kind === "started") {
        const { session, startMode } = outcome.launch;
        // A reused session already exists, so only a new session notifies its start.
        if (session && (startMode === "fresh" || startMode === "fork"))
          occurrence = buildSessionStartedOccurrence(target, { ...input, session });
      } else if (outcome.kind === "failed" && outcome.launch?.failure?.noticeId === undefined) {
        // A failure with a notice id already notified from its session.
        const session = outcome.launch?.session;
        occurrence = buildSessionStartErrorOccurrence(
          target,
          session ? { ...input, session } : input,
          outcome.message,
        );
      }
      if (!occurrence) return null;
      const selected = yield* deps.notifications.publishAction(occurrence, outcome.workspaceId);
      return selected.occurrence.kind === "agent.session_error"
        ? selected.occurrence.occurrenceId
        : null;
    }).pipe(
      Effect.catch((cause) =>
        deps
          .onBackgroundFailure(toHostOperationError(cause, "autopilot.notify"))
          .pipe(Effect.as(null)),
      ),
    );

  const settle = (attempt: Attempt, result: Result.Result<WorkflowLaunchResult, HostError>) =>
    Effect.gen(function* () {
      // Host shutdown and workspace removal drop outcomes.
      const holdsWorkspace = () => {
        const workspace = workspaces.get(attempt.workspaceId);
        return phase === "ready" && workspace !== undefined && workspace.state !== "removing";
      };
      if (!holdsWorkspace()) return;
      const outcome = toOutcome(attempt, result);
      const notificationId = yield* notify(attempt, outcome);
      if (notificationId !== null && outcome.kind === "failed")
        outcome.notificationId = notificationId;
      // The notification can yield, so a removal can happen before the outcome is held.
      if (!holdsWorkspace()) return;
      let held = outcomes.get(attempt.workspaceId);
      if (!held) {
        held = new Map();
        outcomes.set(attempt.workspaceId, held);
      }
      held.set(JSON.stringify([attempt.task.id, attempt.workflow.reference.id, attempt.actionId]), {
        outcome,
        recoveryClaimed: false,
      });
      deps.publish({ type: "autopilot_outcome", outcome });
    });

  const runAttempt = (attempt: Attempt): Effect.Effect<void> =>
    Effect.gen(function* () {
      // The gate keeps arrival order, so the attempt starts after the reporting mutation and its
      // publication leave the gate. It holds nothing that the mutation waits for.
      yield* deps.mutations.runMutation(attempt.gateKey, Effect.void);
      // The launch lane of the task runs launches in arrival order. The start check makes an
      // attempt that waited behind a later change of its task skip.
      const result = yield* Effect.result(
        deps.workflowLaunch.launch({
          workspaceId: attempt.workspaceId,
          repoPath: attempt.repoPath,
          taskId: attempt.task.id,
          policy: {
            kind: "automatic",
            actionId: attempt.actionId,
            startCheck: startCheck(attempt),
          },
          instruction: { kind: "kickoff" },
        }),
      );
      yield* settle(attempt, result);
    });

  const reportAttemptFailure = (cause: Cause.Cause<never>): Effect.Effect<void> =>
    Cause.hasInterruptsOnly(cause)
      ? Effect.void
      : deps.onBackgroundFailure(
          new HostOperationError({
            operation: "autopilot.attempt",
            message: causeMessages(cause).join(" "),
            cause,
          }),
        );

  const runInBackground = (effect: Effect.Effect<void>): void => {
    // A root fiber runs the effect, so it does not inherit the services or references of the
    // mutation. Dispose interrupts it.
    Effect.runFork(FiberSet.run(attempts, effect.pipe(Effect.catchCause(reportAttemptFailure))));
  };

  const recordChange = ({ workspaceId, statusChange: { task } }: CommittedTaskStatusChange) => {
    let tasks = latestChanges.get(workspaceId);
    if (!tasks) {
      tasks = new Map();
      latestChanges.set(workspaceId, tasks);
    }
    lastSequence += 1;
    tasks.set(task.id, { sequence: lastSequence, status: task.status });
    return lastSequence;
  };

  const dispatchRules = (
    {
      workspaceId,
      repoPath,
      statusChange,
      signal,
      workflow,
      autopilotSettings,
    }: CommittedTaskStatusChange,
    notificationTarget: Attempt["notificationTarget"],
    generation: number,
    sequence: number,
  ): void => {
    const eventId = signal;
    if (!eventId) return;
    const rule = autopilotSettings.rules.find(
      (value) => value.workflowId === workflow.id && value.eventId === eventId,
    );
    const taskWorkflow = deps.taskWorkflows.forReference(workflow);
    for (const actionId of rule?.actionIds ?? [])
      runInBackground(
        runAttempt({
          outcomeId: crypto.randomUUID(),
          workspaceId,
          repoPath,
          notificationTarget,
          workflow: taskWorkflow,
          generation,
          sequence,
          gateKey: repoPath,
          task: { id: statusChange.task.id, title: statusChange.task.title },
          eventId,
          actionId,
        }),
      );
  };

  /**
   * Evaluates one change at its commit, with the rules and workspace that its transaction read.
   * The change committed in an open workspace, so the view opens a workspace that another host
   * opened.
   */
  const observe = (change: CommittedTaskStatusChange): void => {
    if (phase !== "ready") return;
    try {
      const workspace = workspaces.open(change.workspaceId);
      dispatchRules(
        change,
        {
          workspaceId: change.workspaceId,
          repoPath: change.workspace.repoPath,
          repositoryLabel: change.workspace.workspaceName,
        },
        workspace.generation,
        recordChange(change),
      );
    } catch (cause) {
      reportFailure(
        `Autopilot could not evaluate a task change: ${errorMessage(cause)} Restart the host.`,
      );
    }
  };

  return {
    /** Starts coverage from the current task states. No agent starts for an existing state. */
    initialize: (): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (phase !== "pending") return;
        const loaded = yield* Effect.result(deps.settingsConfig.readConfig());
        if (loaded._tag === "Failure") {
          reportFailure(
            `Autopilot could not read the application settings: ${loaded.failure.message} Correct the application settings, then restart the host.`,
          );
          return;
        }
        phase = "ready";
        config ??= loaded.success;
        workspaces.applyAll(config);
        if (failure !== null) reportFailure(null);
      }),
    /** Applies this host's saved settings and workspace changes. */
    configCommitted: (next: SettingsConfigView): Effect.Effect<void> =>
      Effect.sync(() => {
        if (phase === "stopped") return;
        const previous = config?.autopilot;
        config = structuredClone(next);
        if (phase === "ready") workspaces.applyAll(config);
        if (!jsonValuesEqual(previous, config.autopilot))
          deps.publish({ type: "autopilot_settings_saved" });
      }),
    observe,
    readState: ({ workspaceId }: AutopilotStateReadInput): AutopilotState => ({
      outcomes: [...(outcomes.get(workspaceId)?.values() ?? [])]
        .map(({ outcome }) => outcome)
        .filter((outcome) => outcome.kind !== "started"),
      failure,
    }),
    /** Lets one client send the unsent first message of a failed automatic launch again. */
    claimRecovery: ({
      workspaceId,
      outcomeId,
    }: AutopilotRecoveryClaimInput): AutopilotRecoveryClaimResult => {
      for (const held of outcomes.get(workspaceId)?.values() ?? []) {
        if (held.outcome.outcomeId !== outcomeId) continue;
        const { outcome } = held;
        if (held.recoveryClaimed || outcome.kind !== "failed" || !outcome.launch?.unsentInstruction)
          return { claimed: false };
        held.recoveryClaimed = true;
        return { claimed: true };
      }
      return { claimed: false };
    },
    /** Discards waiting attempts and outcomes. Started launches follow the launch shutdown. */
    dispose: (): Effect.Effect<void> =>
      Effect.suspend(() => {
        phase = "stopped";
        workspaces.clear();
        latestChanges.clear();
        outcomes.clear();
        config = null;
        return Scope.close(attemptsScope, Exit.void);
      }),
  };
};

export type AutopilotService = ReturnType<typeof createAutopilotService>;
