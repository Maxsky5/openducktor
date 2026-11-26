import type { WorkflowIcon } from "@openducktor/contracts";
import { type AgentSessionRecord, RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import { agentSessionIdentityKey } from "@openducktor/frontend-core/lib/agent-session-identity";
import {
  type AgentSessionRecencySummary,
  buildRoleSessionSequenceByIdentity,
  compareAgentSessionRecency,
  formatAgentSessionOptionLabel,
} from "@openducktor/frontend-core/lib/agent-session-options";
import type { AgentSessionSummary } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import {
  type WorkflowRoleId as AgentRole,
  type ResolvedTaskCard,
  workflowRoleIcon,
  workflowRoleLabel,
} from "@openducktor/workflows";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import {
  AGENT_SESSION_BACKGROUND_DESCRIPTION,
  visibleSessionActivity,
} from "@openducktor/frontend-core/lib/agent-session-activity-state";
import type { AgentSessionActivityState } from "@openducktor/frontend-core/types/agent-session-activity";
import type { IconName } from "@/ui/icon-names";
import type { Tone } from "@/ui/tones";

export type TaskSessionRow = {
  key: string;
  identity: AgentSessionIdentity;
  /** The name of the session in the desktop session selector, such as "Builder #2". */
  label: string;
  /** The name of the runtime of the session, such as "OpenCode". */
  runtimeLabel: string;
  startedAt: string;
  statusLabel: string;
  /** What a screen reader says for the status: the label, or a longer text such as Background. */
  statusDescription: string;
  statusTone: Tone;
  /** Why the status is unavailable, for the row to show under the session name, or null. */
  statusReason: string | null;
  /** The still icon of a state that has one, such as Background. */
  statusIcon: IconName | null;
  /** True while the session works, so its status can show as live. */
  live: boolean;
  /** The live state of the session, or null for a saved session or an unavailable status. */
  activityState: AgentSessionActivityState | null;
  /** The running session waits on background tasks. Only its style changes. */
  waitingOnBackground: boolean;
  /** An earlier member of a chat that handed off to another runtime. */
  historical: boolean;
};

export type TaskSessionGroup = {
  role: AgentRole;
  iconHint?: WorkflowIcon | undefined;
  roleLabel: string;
  rows: TaskSessionRow[];
};

type StatusPresentation = {
  label: string;
  description?: string;
  reason?: string;
  tone: Tone;
  icon?: IconName;
};

const STATUS_PRESENTATION = {
  waiting_input: { label: "Waiting input", tone: "warning" },
  starting: { label: "Starting", tone: "running" },
  running: { label: "Running", tone: "running" },
  idle: { label: "Idle", tone: "neutral" },
  stopped: { label: "Stopped", tone: "cancelled" },
  error: { label: "Error", tone: "destructive" },
} as const satisfies Record<AgentSessionActivityState, StatusPresentation>;

/** A running session that waits on its background tasks: Running in a calm violet, with a still mark. */
const RUNNING_ON_BACKGROUND: StatusPresentation = {
  label: "Running",
  description: AGENT_SESSION_BACKGROUND_DESCRIPTION,
  tone: "pending",
  icon: "hourglass",
};

/** The session list shows a saved session that this client has no live state for. */
const SAVED_SESSION: StatusPresentation = { label: "Saved", tone: "neutral" };

/** The status of a session whose work is unknown, such as while the live stream is down. */
const unavailableStatus = (reason: string): StatusPresentation => ({
  label: "Status unavailable",
  description: `Status unavailable: ${reason}`,
  reason,
  tone: "cancelled",
  icon: "circle-alert",
});

type SessionEntry = AgentSessionRecencySummary & {
  role: AgentRole;
  activityState: AgentSessionActivityState | null;
  waitingOnBackground: boolean;
  statusUnavailableReason: string | null;
};

const toEntry = (
  session: AgentSessionRecord | AgentSessionSummary,
  live: AgentSessionSummary | undefined,
): SessionEntry => ({
  externalSessionId: session.externalSessionId,
  runtimeKind: session.runtimeKind,
  workingDirectory: session.workingDirectory,
  role: session.role,
  startedAt: session.startedAt,
  activityState: live?.activityState ?? null,
  waitingOnBackground: live?.waitingOnBackground ?? false,
  statusUnavailableReason: live?.statusUnavailableReason ?? null,
});

type EntryStatus = {
  presentation: StatusPresentation;
  /** The state that the row shows, or null for a saved session or an unavailable status. */
  activityState: AgentSessionActivityState | null;
};

/** An unavailable status replaces a state that it makes unknown, such as Running or Idle. */
const entryStatus = (entry: SessionEntry): EntryStatus => {
  const activityState = visibleSessionActivity(entry.activityState, entry.statusUnavailableReason);
  if (activityState === "running" && entry.waitingOnBackground)
    return { presentation: RUNNING_ON_BACKGROUND, activityState };
  if (activityState) return { presentation: STATUS_PRESENTATION[activityState], activityState };
  return {
    presentation: entry.statusUnavailableReason
      ? unavailableStatus(entry.statusUnavailableReason)
      : SAVED_SESSION,
    activityState: null,
  };
};

/**
 * The task-bound sessions of a task, grouped by Workflow Role in workflow order, newest first.
 * Saved sessions come from the session history of the task; live state comes from the session
 * store. A live session that the history does not list yet also shows. The order and the session
 * numbers follow the desktop session selector.
 */
export const groupTaskSessions = (
  task: ResolvedTaskCard,
  records: readonly AgentSessionRecord[],
  live: readonly AgentSessionSummary[],
  workspaceId: string,
): TaskSessionGroup[] => {
  const liveByKey = new Map(
    live
      .filter((summary) => summary.workspaceId === workspaceId && summary.taskId === task.id)
      .map((summary) => [agentSessionIdentityKey(summary), summary] as const),
  );
  const entries = new Map<string, SessionEntry>();
  const historical = new Set<string>();
  for (const record of records) {
    const key = agentSessionIdentityKey(record);
    entries.set(key, toEntry(record, liveByKey.get(key)));
    for (const { from } of record.handoff?.links ?? []) {
      historical.add(agentSessionIdentityKey(from));
    }
  }
  for (const [key, summary] of liveByKey) {
    if (!entries.has(key)) entries.set(key, toEntry(summary, summary));
  }
  // A moved task can keep sessions of a role that its version does not bind. They follow the
  // bound roles and take their label from the catalog role.
  const roles = new Set([
    ...task.taskWorkflow.roles.map(({ id }) => id),
    ...[...entries.values()].map((entry) => entry.role),
  ]);
  return [...roles].flatMap((role) => {
    const label = workflowRoleLabel(task.taskWorkflow, role);
    const roleEntries = [...entries.values()].filter((entry) => entry.role === role);
    const sessionNumbers = buildRoleSessionSequenceByIdentity(roleEntries);
    const rows = roleEntries.toSorted(compareAgentSessionRecency).map((entry, index) => {
      const key = agentSessionIdentityKey(entry);
      const { presentation: status, activityState } = entryStatus(entry);
      return {
        key,
        identity: {
          externalSessionId: entry.externalSessionId,
          runtimeKind: entry.runtimeKind,
          workingDirectory: entry.workingDirectory,
        },
        label: formatAgentSessionOptionLabel({
          session: entry,
          sessionNumber: sessionNumbers.get(key) ?? index + 1,
          roleLabelByRole: { [role]: label },
        }),
        runtimeLabel: RUNTIME_DESCRIPTORS_BY_KIND[entry.runtimeKind].label,
        startedAt: entry.startedAt,
        statusLabel: status.label,
        statusDescription: status.description ?? status.label,
        statusTone: status.tone,
        statusReason: status.reason ?? null,
        statusIcon: status.icon ?? null,
        live: activityState === "running" || activityState === "starting",
        activityState,
        waitingOnBackground: activityState === "running" && entry.waitingOnBackground,
        historical: historical.has(key),
      };
    });
    return rows.length > 0
      ? [{ role, roleLabel: label, iconHint: workflowRoleIcon(task.taskWorkflow, role), rows }]
      : [];
  });
};
