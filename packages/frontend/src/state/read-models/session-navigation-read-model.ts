import {
  DEFAULT_APPEARANCE_SETTINGS,
  type AgentSessionRecord,
  type RuntimeKind,
  type SidebarSessionGrouping,
  type TaskCard,
  type WorkspaceRecord,
  type WorkspaceSession,
} from "@openducktor/contracts";
import {
  type SessionNavigationTarget,
  sessionNavigationTargetKey,
} from "@/features/session-navigation/session-navigation-target";
import type {
  WorkspaceSessionLiveFacts,
  WorkspaceSessionLiveState,
} from "@/features/workspace-activity/workspace-activity-state";
import {
  isAgentSessionActivityActive,
  isAgentSessionActivityWorking,
} from "@/lib/agent-session-activity-state";
import { agentSessionIdentityKey, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import { buildRoleWorkflowState } from "@/lib/agent-workflow-state";
import { roleWorkflowForTask } from "@/lib/task-agent-workflows";
import { parseTimestamp } from "@/lib/timestamps";
import {
  workspaceSessionIdentity,
  workspaceSessionTitle,
} from "@/state/operations/agent-orchestrator/session-read-model/workspace-session-records";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { AgentWorkflowStepTone } from "@/types/agent-workflow";

/**
 * One server read as the sidebar sees it. Loading and failure never become empty data.
 * A failed refresh keeps the last data and reports the failure beside it.
 */
export type SessionNavigationRead<Data> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: Data; refreshError: string | null };

export type SessionNavigationWorkspace = Pick<
  WorkspaceRecord,
  "workspaceId" | "workspaceName" | "repoPath" | "abbreviation" | "tileColor" | "iconDataUrl"
>;

export type SessionNavigationWorkspaceSources = {
  workspace: SessionNavigationWorkspace;
  tasks: SessionNavigationRead<TaskCard[]>;
  /** Saved task sessions by task ID, for the tasks in `tasks`. */
  taskSessions: ReadonlyMap<string, SessionNavigationRead<AgentSessionRecord[]>>;
  workspaceSessions: SessionNavigationRead<WorkspaceSession[]>;
  live: WorkspaceSessionLiveState;
};

export type SessionNavigationAttentionReason = "question" | "permission" | "blocked";

export type SessionNavigationStatus =
  | { kind: "running" }
  | { kind: "settled"; failed: boolean }
  /** Live status has not answered yet. */
  | { kind: "checking" }
  /** Live status is lost. Known attention still applies. */
  | { kind: "unavailable"; reason: string };

/**
 * Time used to order and label an entry.
 *
 * `started` means no later activity time is known, so the UI must not present it as the
 * latest activity.
 */
export type SessionNavigationTime =
  | { kind: "activity"; at: number }
  | { kind: "started"; at: number }
  | { kind: "none" };

/**
 * One sidebar entry. Its target opens it, and the key of that target identifies it.
 *
 * A `task` target is a blocked task that has no saved session.
 */
export type SessionNavigationEntry = {
  key: string;
  target: SessionNavigationTarget;
  workspace: SessionNavigationWorkspace;
  title: string;
  /** Saved runtime identity, or null for a task without a saved session. */
  runtimeKind: RuntimeKind | null;
  /** Workflow state for a task session. Other entries have no workflow role. */
  workflowTone: AgentWorkflowStepTone | null;
  attention: SessionNavigationAttentionReason[];
  status: SessionNavigationStatus;
  time: SessionNavigationTime;
  fault: string | null;
  /** Cached records for the preview. Opening it does not fetch tasks or session history. */
  context:
    | { kind: "task"; task: TaskCard; sessions: readonly AgentSessionRecord[] }
    | { kind: "workspace"; session: WorkspaceSession };
};

export type SessionNavigationGroupId = "needs_you" | "running" | "recent";

export type SessionNavigationGroup = {
  id: SessionNavigationGroupId;
  entries: SessionNavigationEntry[];
};

export type SessionNavigationSourceIssue = {
  workspace: SessionNavigationWorkspace;
  source: "tasks" | "task_sessions" | "workspace_sessions" | "live_status";
  message: string;
};

type TaskBlockTarget = Extract<SessionNavigationTarget, { kind: "task" | "task_session" }>;
type TaskBlockSnapshot = {
  workspaceId: string;
  tasks: { taskId: string; blocked: boolean; target: TaskBlockTarget | null }[];
};

export type SessionNavigationModel = {
  /** Always Needs you, Running, and Recent, in this order. */
  groups: SessionNavigationGroup[];
  entryCount: number;
  /** True while a source has not answered yet. Entries shown so far stay usable. */
  isLoading: boolean;
  issues: SessionNavigationSourceIssue[];
  /** Confirmed task state before grouping can hide its row. */
  taskBlocks: TaskBlockSnapshot[];
};

export const SESSION_NAVIGATION_GROUP_ORDER: readonly SessionNavigationGroupId[] = [
  "needs_you",
  "running",
  "recent",
];

/**
 * Join saved records, task state, live facts, and activity times into the three sidebar groups.
 *
 * Only saved task roots and saved, non-archived workspace roots become entries, so live
 * sessions without a saved record never appear. Each entry belongs to exactly one group.
 */
export const buildSessionNavigationModel = (
  workspaces: readonly SessionNavigationWorkspaceSources[],
  grouping: SidebarSessionGrouping = DEFAULT_APPEARANCE_SETTINGS.sidebarSessionGrouping,
): SessionNavigationModel => {
  const entries = workspaces.flatMap((sources) => [
    ...taskEntries(sources, grouping),
    ...workspaceEntries(sources),
  ]);
  const grouped = new Map<SessionNavigationGroupId, SessionNavigationEntry[]>(
    SESSION_NAVIGATION_GROUP_ORDER.map((id) => [id, []]),
  );
  for (const entry of entries) {
    grouped.get(entryGroup(entry))?.push(entry);
  }
  return {
    groups: SESSION_NAVIGATION_GROUP_ORDER.map((id) => ({
      id,
      entries: (grouped.get(id) ?? []).sort(compareEntries),
    })),
    entryCount: entries.length,
    isLoading: workspaces.some(isWorkspaceLoading),
    issues: workspaces.flatMap(workspaceIssues),
    taskBlocks: workspaces.flatMap(taskBlockSnapshot),
  };
};

const taskBlockSnapshot = (sources: SessionNavigationWorkspaceSources): TaskBlockSnapshot[] => {
  if (sources.tasks.status !== "ready" || sources.tasks.refreshError !== null) return [];
  return [
    {
      workspaceId: sources.workspace.workspaceId,
      tasks: sources.tasks.data
        .filter((task) => task.status !== "closed")
        .map((task) => ({
          taskId: task.id,
          blocked: task.status === "blocked",
          target: taskBlockTarget(sources, task),
        })),
    },
  ];
};

const taskBlockTarget = (
  sources: SessionNavigationWorkspaceSources,
  task: TaskCard,
): TaskBlockTarget | null => {
  const read = sources.taskSessions.get(task.id);
  if (task.status !== "blocked" || read?.status !== "ready" || read.refreshError !== null) {
    return null;
  }
  const record = latestStartedRecord(read.data);
  return record
    ? {
        kind: "task_session",
        workspaceId: sources.workspace.workspaceId,
        taskId: task.id,
        role: record.role,
        identity: toAgentSessionIdentity(record),
      }
    : { kind: "task", workspaceId: sources.workspace.workspaceId, taskId: task.id, role: null };
};

const navigationEntry = (
  target: SessionNavigationTarget,
  entry: Omit<SessionNavigationEntry, "key" | "target">,
): SessionNavigationEntry => ({ key: sessionNavigationTargetKey(target), target, ...entry });

type SessionLiveFacts = {
  facts: WorkspaceSessionLiveFacts | null;
  /** A fault of the session or of its live subagents. */
  fault: string | null;
  /** The failure message when the current status of the session could not be read. */
  statusFailure: string | null;
};

/** A session fault stays on its entry also when the session has no live facts. */
const sessionLiveFactsOf = (
  live: WorkspaceSessionLiveState,
  identity: AgentSessionIdentity | null,
): SessionLiveFacts => {
  if (!identity || live.kind === "unknown") {
    return { facts: null, fault: null, statusFailure: null };
  }
  const key = agentSessionIdentityKey(identity);
  const facts = live.sessions.get(key) ?? null;
  const ownFault = live.faults.get(key);
  const statusFailure =
    facts?.statusUnavailableReason ?? (ownFault?.statusUnavailable ? ownFault.message : null);
  return {
    facts,
    fault: facts?.fault ?? ownFault?.message ?? null,
    statusFailure,
  };
};

const liveAttention = (
  facts: WorkspaceSessionLiveFacts | null,
): SessionNavigationAttentionReason[] => {
  const reasons: SessionNavigationAttentionReason[] = [];
  if (facts?.pendingQuestion) reasons.push("question");
  if (facts?.pendingPermission) reasons.push("permission");
  return reasons;
};

/**
 * A lost stream cannot confirm running or idle state, so only a ready stream reports it.
 * A ready stream without the session means that the session is not running. A failed status
 * read of the session makes its status unknown, also when an older snapshot stays.
 */
const sessionStatus = (
  live: WorkspaceSessionLiveState,
  { facts, statusFailure }: SessionLiveFacts,
): SessionNavigationStatus => {
  if (live.kind === "unknown") return { kind: "checking" };
  if (live.kind === "unavailable") return { kind: "unavailable", reason: live.reason };
  if (statusFailure !== null) return { kind: "unavailable", reason: statusFailure };
  if (facts && isAgentSessionActivityWorking(facts.activityState)) return { kind: "running" };
  return { kind: "settled", failed: facts?.activityState === "error" };
};

const taskSessionTime = (record: AgentSessionRecord): SessionNavigationTime => {
  if (record.lastActivityAt !== undefined) return { kind: "activity", at: record.lastActivityAt };
  const startedAt = parseTimestamp(record.startedAt);
  return startedAt === null ? { kind: "none" } : { kind: "started", at: startedAt };
};

/** Select the latest started saved session, with a stable identity tie-breaker. */
const latestStartedRecord = (records: readonly AgentSessionRecord[]): AgentSessionRecord | null => {
  let latest: AgentSessionRecord | null = null;
  for (const record of records) {
    if (!latest || isNewerRecord(record, latest)) {
      latest = record;
    }
  }
  return latest;
};

const isNewerRecord = (record: AgentSessionRecord, current: AgentSessionRecord): boolean =>
  record.startedAt > current.startedAt ||
  (record.startedAt === current.startedAt &&
    agentSessionIdentityKey(record) < agentSessionIdentityKey(current));

const taskEntries = (
  sources: SessionNavigationWorkspaceSources,
  grouping: SidebarSessionGrouping,
): SessionNavigationEntry[] => {
  if (sources.tasks.status !== "ready") return [];
  const { workspace, live } = sources;
  const entries: SessionNavigationEntry[] = [];
  for (const task of sources.tasks.data) {
    if (task.status === "closed") continue;
    const read = sources.taskSessions.get(task.id);
    if (read?.status !== "ready") continue;
    const isBlocked = task.status === "blocked";
    if (read.data.length === 0) {
      // Only a current empty read proves that the task has no saved session.
      if (isBlocked && read.refreshError === null) {
        entries.push(
          navigationEntry(
            { kind: "task", workspaceId: workspace.workspaceId, taskId: task.id, role: null },
            {
              workspace,
              title: task.title,
              runtimeKind: null,
              workflowTone: null,
              attention: ["blocked"],
              status: { kind: "settled", failed: false },
              time: { kind: "none" },
              fault: null,
              context: { kind: "task", task, sessions: read.data },
            },
          ),
        );
      }
      continue;
    }
    const hasActiveSession =
      live.kind === "ready" &&
      read.data.some((record) => {
        const { facts, statusFailure } = sessionLiveFactsOf(live, toAgentSessionIdentity(record));
        return (
          facts !== null &&
          statusFailure === null &&
          isAgentSessionActivityActive(facts.activityState)
        );
      });
    const blockedRecord = isBlocked && !hasActiveSession ? latestStartedRecord(read.data) : null;
    let latest: SessionNavigationEntry | null = null;
    let needsInput = false;
    for (const record of read.data) {
      const identity = toAgentSessionIdentity(record);
      const liveFacts = sessionLiveFactsOf(live, identity);
      const { facts } = liveFacts;
      const attention = liveAttention(facts);
      if (record === blockedRecord) attention.push("blocked");
      const entry = navigationEntry(
        {
          kind: "task_session",
          workspaceId: workspace.workspaceId,
          taskId: task.id,
          role: record.role,
          identity,
        },
        {
          workspace,
          title: task.title,
          runtimeKind: record.runtimeKind,
          workflowTone: buildRoleWorkflowState({
            task,
            role: record.role,
            workflow: roleWorkflowForTask(task, record.role),
            liveSession: facts?.activityState ?? "none",
          }).tone,
          attention,
          status: sessionStatus(live, liveFacts),
          time: taskSessionTime(record),
          fault: liveFacts.fault,
          context: { kind: "task", task, sessions: read.data },
        },
      );
      if (grouping === "none") {
        entries.push(entry);
        continue;
      }
      if (attention.length > 0) {
        needsInput = true;
        entries.push(entry);
        continue;
      }
      const running = entry.status.kind === "running";
      const latestRunning = latest?.status.kind === "running";
      if (
        !latest ||
        (running && !latestRunning) ||
        (running === latestRunning && compareEntries(entry, latest) < 0)
      ) {
        latest = entry;
      }
    }
    // A task awaiting input has no idle row for its past sessions.
    if (latest && (!needsInput || latest.status.kind === "running")) {
      entries.push(latest);
    }
  }
  return entries;
};

const workspaceEntries = (sources: SessionNavigationWorkspaceSources): SessionNavigationEntry[] => {
  if (sources.workspaceSessions.status !== "ready") return [];
  const { workspace, live } = sources;
  return sources.workspaceSessions.data.flatMap((record): SessionNavigationEntry[] => {
    if (record.archivedAt !== null) return [];
    const liveFacts = sessionLiveFactsOf(live, workspaceSessionIdentity(record));
    const { facts } = liveFacts;
    return [
      navigationEntry(
        { kind: "workspace_session", workspaceId: workspace.workspaceId, sessionId: record.id },
        {
          workspace,
          title: workspaceSessionTitle(record),
          runtimeKind: record.runtimeKind,
          workflowTone: null,
          attention: liveAttention(facts),
          status: sessionStatus(live, liveFacts),
          time:
            record.lastActivityAt === undefined
              ? { kind: "started", at: record.createdAt }
              : { kind: "activity", at: record.lastActivityAt },
          fault: liveFacts.fault,
          context: { kind: "workspace", session: record },
        },
      ),
    ];
  });
};

const entryGroup = (entry: SessionNavigationEntry): SessionNavigationGroupId => {
  if (entry.attention.length > 0) return "needs_you";
  if (entry.status.kind === "running") return "running";
  return "recent";
};

const entryTime = (entry: SessionNavigationEntry): number | null =>
  entry.time.kind === "none" ? null : entry.time.at;

/** Newest known time first; entries without a time follow; the key breaks ties. */
const compareEntries = (left: SessionNavigationEntry, right: SessionNavigationEntry): number => {
  const leftTime = entryTime(left);
  const rightTime = entryTime(right);
  if (leftTime !== rightTime) {
    if (leftTime === null) return 1;
    if (rightTime === null) return -1;
    return rightTime - leftTime;
  }
  if (left.key === right.key) return 0;
  return left.key < right.key ? -1 : 1;
};

const readFailure = (read: SessionNavigationRead<unknown>): string | null => {
  if (read.status === "error") return read.message;
  return read.status === "ready" ? read.refreshError : null;
};

const readIssue = (
  workspace: SessionNavigationWorkspace,
  source: SessionNavigationSourceIssue["source"],
  read: SessionNavigationRead<unknown>,
): SessionNavigationSourceIssue[] => {
  const message = readFailure(read);
  return message === null ? [] : [{ workspace, source, message }];
};

const taskSessionIssue = (
  sources: SessionNavigationWorkspaceSources,
): SessionNavigationSourceIssue[] => {
  const failures = [...sources.taskSessions.values()].flatMap((read) => {
    const message = readFailure(read);
    return message === null ? [] : [message];
  });
  const [firstFailure] = failures;
  if (firstFailure === undefined) return [];
  const message =
    failures.length === 1
      ? firstFailure
      : `${firstFailure} (${failures.length} tasks could not load their sessions.)`;
  return [{ workspace: sources.workspace, source: "task_sessions", message }];
};

const workspaceIssues = (
  sources: SessionNavigationWorkspaceSources,
): SessionNavigationSourceIssue[] => [
  ...readIssue(sources.workspace, "tasks", sources.tasks),
  ...taskSessionIssue(sources),
  ...readIssue(sources.workspace, "workspace_sessions", sources.workspaceSessions),
  ...(sources.live.kind === "unavailable"
    ? [
        {
          workspace: sources.workspace,
          source: "live_status" as const,
          message: sources.live.reason,
        },
      ]
    : []),
];

const isWorkspaceLoading = (sources: SessionNavigationWorkspaceSources): boolean =>
  sources.tasks.status === "loading" ||
  sources.workspaceSessions.status === "loading" ||
  [...sources.taskSessions.values()].some((read) => read.status === "loading");
