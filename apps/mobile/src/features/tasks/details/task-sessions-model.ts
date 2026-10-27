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
  BUILTIN_ROLE_LABELS,
  builtinRoleId,
  type BuiltinRoleId as AgentRole,
} from "@openducktor/workflows";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import type { AgentSessionActivityState } from "@openducktor/frontend-core/types/agent-session-activity";
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
  statusTone: Tone;
  /** True while the session works, so its status can show as live. */
  live: boolean;
  /** The live state of the session, or null for a saved session without live state. */
  activityState: AgentSessionActivityState | null;
};

export type TaskSessionGroup = { role: AgentRole; roleLabel: string; rows: TaskSessionRow[] };

const ROLE_ORDER: readonly AgentRole[] = ["spec", "planner", "build", "qa"];

const STATUS_PRESENTATION = {
  waiting_input: { label: "Waiting input", tone: "warning" },
  starting: { label: "Starting", tone: "running" },
  running: { label: "Running", tone: "running" },
  idle: { label: "Idle", tone: "neutral" },
  stopped: { label: "Stopped", tone: "cancelled" },
  error: { label: "Error", tone: "destructive" },
} as const satisfies Record<AgentSessionActivityState, { label: string; tone: Tone }>;

/** The session list shows a saved session that this client has no live state for. */
const SAVED_SESSION = { label: "Saved", tone: "neutral" } as const;

type SessionEntry = AgentSessionRecencySummary & {
  role: AgentRole;
  activityState: AgentSessionActivityState | null;
};

const toEntry = (
  session: AgentSessionRecord | AgentSessionSummary,
  activityState: AgentSessionActivityState | null,
): SessionEntry => ({
  externalSessionId: session.externalSessionId,
  runtimeKind: session.runtimeKind,
  workingDirectory: session.workingDirectory,
  role: builtinRoleId(session.role),
  startedAt: session.startedAt,
  activityState,
});

/**
 * The task-bound sessions of a task, grouped by Workflow Role in workflow order, newest first.
 * Saved sessions come from the session history of the task; live state comes from the session
 * store. A live session that the history does not list yet also shows. The order and the session
 * numbers follow the desktop session selector.
 */
export const groupTaskSessions = (
  taskId: string,
  records: readonly AgentSessionRecord[],
  live: readonly AgentSessionSummary[],
): TaskSessionGroup[] => {
  const liveByKey = new Map(
    live
      .filter((summary) => summary.taskId === taskId)
      .map((summary) => [agentSessionIdentityKey(summary), summary] as const),
  );
  const entries = new Map<string, SessionEntry>();
  for (const record of records) {
    const key = agentSessionIdentityKey(record);
    entries.set(key, toEntry(record, liveByKey.get(key)?.activityState ?? null));
  }
  for (const [key, summary] of liveByKey) {
    if (!entries.has(key)) entries.set(key, toEntry(summary, summary.activityState));
  }
  return ROLE_ORDER.flatMap((role) => {
    const roleEntries = [...entries.values()].filter((entry) => entry.role === role);
    const sessionNumbers = buildRoleSessionSequenceByIdentity(roleEntries);
    const rows = roleEntries.toSorted(compareAgentSessionRecency).map((entry, index) => {
      const key = agentSessionIdentityKey(entry);
      const status = entry.activityState ? STATUS_PRESENTATION[entry.activityState] : SAVED_SESSION;
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
          roleLabelByRole: BUILTIN_ROLE_LABELS,
        }),
        runtimeLabel: RUNTIME_DESCRIPTORS_BY_KIND[entry.runtimeKind].label,
        startedAt: entry.startedAt,
        statusLabel: status.label,
        statusTone: status.tone,
        live: entry.activityState === "running" || entry.activityState === "starting",
        activityState: entry.activityState,
      };
    });
    return rows.length > 0 ? [{ role, roleLabel: BUILTIN_ROLE_LABELS[role], rows }] : [];
  });
};
