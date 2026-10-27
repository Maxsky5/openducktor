import type {
  AutopilotOutcome,
  AutopilotRecoveryClaimInput,
  AutopilotRecoveryClaimResult,
  AutopilotRunEvent,
  AutopilotState,
  AutopilotStateReadInput,
  GlobalConfig,
  NotificationActionOccurrence,
  WorkflowLaunchResult,
} from "@openducktor/contracts";
import {
  buildSessionStartErrorOccurrence,
  buildSessionStartedOccurrence,
  sessionLaunchFailureMessage,
} from "@openducktor/core";
import { Cause, Effect, Exit, FiberSet, type Result, Scope } from "effect";
import { normalizePathForComparison } from "../../domain/path-comparison";
import {
  causeMessages,
  errorMessage,
  type HostError,
  HostOperationError,
  type HostOperationErrorAggregate,
  toHostOperationError,
} from "../../effect/host-errors";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { StoredTask, TaskWorkflowResolver } from "../../ports/task-workflow-port";
import type {
  AutomaticWorkflowLaunchStartCheck,
  WorkflowLaunchService,
} from "../agent-sessions/workflow-launch-types";
import type { NotificationService } from "../notifications/notification-service";
import type { TaskSyncService } from "../tasks/sync/task-sync-service";
import type { CommittedTaskStatusChange } from "../tasks/task-mutation-operation";
import type { TaskService } from "../tasks/task-service";
import { loadGlobalConfig } from "../workspaces/workspace-settings-model";

type WorkspaceView = {
  workspaceId: string;
  repoPath: string;
  workspaceName: string;
  state: "open" | "closed" | "removing";
  /** Changes each time the workspace opens, so an attempt from before a close never starts. */
  generation: number;
};

/** One automatic action for one qualifying committed change. */
type Attempt = {
  outcomeId: string;
  workspaceId: string;
  repoPath: string;
  generation: number;
  /** The mutation gate key of the mutation that committed the change. */
  gateKey: string;
  /** Identifies the committed change. Duplicate prevention uses it, not the task or session. */
  sequence: number;
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

const workspaceState = (repo: GlobalConfig["workspaces"][string]): WorkspaceView["state"] => {
  if (repo.removal) return "removing";
  if (repo.closed) return "closed";
  return "open";
};

/**
 * Runs Autopilot for every open workspace. It reacts to committed task status changes, uses the
 * saved rules, and starts each qualifying action at most once through the workflow launch
 * service. All state stays in memory, so a host restart loses waiting attempts and outcomes.
 */
export const createAutopilotService = (deps: AutopilotServiceDependencies) => {
  const stateTitle = (task: StoredTask, status: string): string => {
    const state = deps.taskWorkflows.forTask(task).state(status);
    return state.title ?? state.label;
  };
  let phase: "pending" | "ready" | "stopped" = "pending";
  /** The latest saved settings. Before the first save, the settings that initialize read. */
  let config: GlobalConfig | null = null;
  let failure: string | null = null;
  let lastSequence = 0;
  let lastGeneration = 0;
  const workspaces = new Map<string, WorkspaceView>();
  /** The latest committed status change of each task, by workspace and task. */
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

  const ruleActions = (eventId: string): string[] =>
    config?.autopilot.rules.find((rule) => rule.eventId === eventId)?.actionIds ?? [];

  // A waiting attempt of a removed workspace skips at its start check, and settle drops it.
  const forgetWorkspace = (workspaceId: string): void => {
    latestChanges.delete(workspaceId);
    outcomes.delete(workspaceId);
  };

  const applyWorkspaces = (next: GlobalConfig): void => {
    const previous = new Map(workspaces);
    workspaces.clear();
    for (const [workspaceId, repo] of Object.entries(next.workspaces)) {
      const known = previous.get(workspaceId);
      const state = workspaceState(repo);
      if (state === "removing" && known?.state !== "removing") forgetWorkspace(workspaceId);
      workspaces.set(workspaceId, {
        workspaceId,
        repoPath: repo.repoPath,
        workspaceName: repo.workspaceName,
        state,
        generation:
          state === "open" && known?.state !== "open"
            ? ++lastGeneration
            : (known?.generation ?? lastGeneration),
      });
    }
    for (const workspaceId of previous.keys())
      if (!workspaces.has(workspaceId)) forgetWorkspace(workspaceId);
  };

  const findWorkspace = (repoPath: string): WorkspaceView | undefined => {
    const path = normalizePathForComparison(repoPath);
    for (const workspace of workspaces.values())
      if (normalizePathForComparison(workspace.repoPath) === path) return workspace;
    return undefined;
  };

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
        .listTaskIds({ repoPath: attempt.repoPath })
        .pipe(Effect.mapError((cause) => toHostOperationError(cause, "autopilot.start-check")));
      // The workspace can close, reopen, or go away while the read waits.
      const closedDuringRead = workspaceSkip(attempt);
      if (closedDuringRead) return closedDuringRead;
      if (!taskIds.includes(attempt.task.id))
        return skip("The task was deleted before the action started.");
      if (!ruleActions(attempt.eventId).includes(attempt.actionId))
        return skip("The Autopilot rule was disabled before the action started.");
      const latest = latestChanges.get(attempt.workspaceId)?.get(attempt.task.id);
      if (latest && latest.sequence !== attempt.sequence)
        return skip(
          `The task moved to ${stateTitle(attempt.task, latest.status)} before the action started.`,
        );
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
      eventId: attempt.eventId,
      actionId: attempt.actionId,
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
  const notify = (
    outcome: AutopilotOutcome,
    workspace: WorkspaceView,
  ): Effect.Effect<string | null> => {
    const target = { repoPath: workspace.repoPath, repositoryLabel: workspace.workspaceName };
    const workflow = deps.taskWorkflows.forTask(outcome.task);
    const { role } = workflow.automation(outcome.actionId);
    const input = {
      launchAttemptId: outcome.outcomeId,
      taskId: outcome.task.id,
      taskTitle: outcome.task.title,
      role,
      roleLabel: workflow.role(role).label,
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
    if (!occurrence) return Effect.succeed(null);
    return deps.notifications.publishAction(occurrence).pipe(
      Effect.map((selected) =>
        selected.occurrence.kind === "agent.session_error"
          ? selected.occurrence.occurrenceId
          : null,
      ),
      Effect.catch((cause) =>
        deps
          .onBackgroundFailure(toHostOperationError(cause, "autopilot.notify"))
          .pipe(Effect.as(null)),
      ),
    );
  };

  const settle = (attempt: Attempt, result: Result.Result<WorkflowLaunchResult, HostError>) =>
    Effect.gen(function* () {
      // Host shutdown and workspace removal drop outcomes.
      const heldWorkspace = () => {
        const workspace = workspaces.get(attempt.workspaceId);
        return phase === "ready" && workspace?.state !== "removing" ? workspace : undefined;
      };
      const workspace = heldWorkspace();
      if (!workspace) return;
      const outcome = toOutcome(attempt, result);
      const notificationId = yield* notify(outcome, workspace);
      if (notificationId !== null && outcome.kind === "failed")
        outcome.notificationId = notificationId;
      // The notification can yield, so a removal can happen before the outcome is held.
      if (!heldWorkspace()) return;
      let held = outcomes.get(attempt.workspaceId);
      if (!held) {
        held = new Map();
        outcomes.set(attempt.workspaceId, held);
      }
      held.set(JSON.stringify([attempt.task.id, attempt.actionId]), {
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

  const dispatch = (attempt: Attempt): void => {
    // A root fiber forks the attempt, so it does not inherit the services or references of the
    // mutation.
    Effect.runFork(
      FiberSet.run(attempts, runAttempt(attempt).pipe(Effect.catchCause(reportAttemptFailure))),
    );
  };

  /** Evaluates one change at its commit, with the rules saved at that moment. */
  const observe = ({ repoPath, statusChange, signal }: CommittedTaskStatusChange): void => {
    if (phase !== "ready") return;
    // The mutation already committed, so an error here must not fail it.
    try {
      const workspace = findWorkspace(repoPath);
      if (!workspace) {
        reportFailure(
          `Autopilot cannot match task changes in ${repoPath} to a workspace. Restart the host.`,
        );
        return;
      }
      if (workspace.state !== "open") return;
      let tasks = latestChanges.get(workspace.workspaceId);
      if (!tasks) {
        tasks = new Map();
        latestChanges.set(workspace.workspaceId, tasks);
      }
      lastSequence += 1;
      const { task } = statusChange;
      tasks.set(task.id, { sequence: lastSequence, status: task.status });
      const eventId = signal;
      if (!eventId) return;
      for (const actionId of ruleActions(eventId))
        dispatch({
          outcomeId: crypto.randomUUID(),
          workspaceId: workspace.workspaceId,
          repoPath: workspace.repoPath,
          generation: workspace.generation,
          gateKey: repoPath,
          sequence: lastSequence,
          task: { id: task.id, title: task.title },
          eventId,
          actionId,
        });
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
        const loaded = yield* Effect.result(loadGlobalConfig(deps.settingsConfig));
        if (loaded._tag === "Failure") {
          reportFailure(
            `Autopilot could not read the application settings: ${loaded.failure.message} Correct the application settings, then restart the host.`,
          );
          return;
        }
        phase = "ready";
        config ??= loaded.success;
        applyWorkspaces(config);
        if (failure !== null) reportFailure(null);
      }),
    /** Applies saved settings and workspace changes to later task changes and start checks. */
    configCommitted: (next: GlobalConfig): Effect.Effect<void> =>
      Effect.sync(() => {
        if (phase === "stopped") return;
        const previous = config?.autopilot;
        config = structuredClone(next);
        if (phase === "ready") applyWorkspaces(config);
        // Clients read the saved rules again, also when another client saved them.
        if (JSON.stringify(previous) !== JSON.stringify(config.autopilot))
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
