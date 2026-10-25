import { agentSessionIdentityKey } from "@openducktor/frontend-core/lib/agent-session-identity";
import type { SubagentMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import {
  isSubagentWaitingForInput,
  readSubagentDurationMs,
  readSubagentError,
  readSubagentSummary,
  type SessionSubagent,
  SUBAGENT_WAITING_FOR_INPUT_LABEL,
  subagentDisplayName,
  subagentStatusLabel,
} from "@openducktor/frontend-core/sessions/session-view/subagent-activity";
import {
  type ParentSessionRuntimeContext,
  toSubagentSessionIdentity,
} from "@openducktor/frontend-core/sessions/transcript/subagent-session-key";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import { withAlpha } from "@/theme/color-alpha";
import type { AppTheme } from "@/theme/tokens";

/** The status tone of a Subagent. Waiting for input has its own amber, as on desktop. */
export type SubagentTone =
  | "pending"
  | "running"
  | "success"
  | "cancelled"
  | "destructive"
  | "warning";

/** One Subagent, as the transcript card and the Subagents panel show it. */
export type SubagentView = {
  name: string;
  statusLabel: string;
  tone: SubagentTone;
  /** The task that the parent gave the Subagent, or null. */
  summary: string | null;
  error: string | null;
  durationMs: number | null;
  pendingInputCount: number;
  /** True while the Subagent runs or waits for input. */
  active: boolean;
  mode: string | null;
  /** The Subagent session that a Read-only Session View opens, or null when it has none yet. */
  session: AgentSessionIdentity | null;
  accessibilityLabel: string;
};

/** A Subagent in the Subagents panel, with its runtime correlation key. */
export type SubagentRow = SubagentView & { key: string };

const STATUS_TONES = {
  pending: "pending",
  running: "running",
  completed: "success",
  cancelled: "cancelled",
  error: "destructive",
} satisfies Record<SubagentMeta["status"], SubagentTone>;

/**
 * One Subagent with its status, task, and pending input. `session` is its Subagent session, and
 * `pendingInputCount` counts the pending approvals and questions of that session.
 */
export const describeSubagent = (
  meta: SubagentMeta,
  session: AgentSessionIdentity | null,
  pendingInputCount: number,
): SubagentView => {
  const waiting = isSubagentWaitingForInput(meta, pendingInputCount);
  const statusLabel = waiting ? SUBAGENT_WAITING_FOR_INPUT_LABEL : subagentStatusLabel(meta.status);
  const name = subagentDisplayName(meta);
  const summary = readSubagentSummary(meta);
  return {
    name,
    statusLabel,
    tone: waiting ? "warning" : STATUS_TONES[meta.status],
    summary,
    error: readSubagentError(meta) ?? null,
    durationMs: readSubagentDurationMs(meta),
    pendingInputCount,
    active: waiting || meta.status === "running",
    mode: meta.executionMode ?? null,
    session,
    accessibilityLabel: [name, statusLabel, summary].filter(Boolean).join(", "),
  };
};

/**
 * The rows of the Subagents panel. `pendingBySessionKey` holds the pending approvals and
 * questions of each Subagent session, by session identity key.
 */
export const buildSubagentRows = (
  subagents: readonly SessionSubagent[],
  parentSession: ParentSessionRuntimeContext,
  pendingBySessionKey: Readonly<Record<string, number>>,
): SubagentRow[] =>
  subagents.map(({ key, meta }) => {
    const session = toSubagentSessionIdentity({
      externalSessionId: meta.externalSessionId,
      parentSession,
    });
    const pending = session ? (pendingBySessionKey[agentSessionIdentityKey(session)] ?? 0) : 0;
    return { key, ...describeSubagent(meta, session, pending) };
  });

const subagentCounts = (rows: readonly SubagentView[]) => [
  rows.length,
  rows.filter((row) => row.active).length,
  rows.filter((row) => row.pendingInputCount > 0).length,
];

/** The spoken summary of the Subagents list: the count, the active ones, and those that wait. */
export const subagentsSummaryLabel = (rows: readonly SubagentView[]): string => {
  const [count, active, waiting] = subagentCounts(rows);
  return [
    `Subagents, ${count}`,
    active ? `${active} active` : null,
    waiting ? `${waiting} waiting for input` : null,
  ]
    .filter(Boolean)
    .join(", ");
};

/** The detail of the Subagents menu item, such as "3 · 1 waiting for input". */
export const subagentsMenuDetail = (rows: readonly SubagentView[]): string => {
  const [count, active, waiting] = subagentCounts(rows);
  return [
    String(count),
    waiting ? `${waiting} waiting for input` : null,
    active ? `${active} active` : null,
  ]
    .filter(Boolean)
    .join(" · ");
};

export type SubagentPillColors = { surface: string; border: string; text: string };

/**
 * The desktop Subagent status pill colors: sky while running, emerald when done, the cancelled
 * family when cancelled, rose on failure, and amber while pending or waiting for input.
 */
export const subagentPillColors = (theme: AppTheme, tone: SubagentTone): SubagentPillColors => {
  const { palette, desktop } = theme;
  const dark = theme.scheme === "dark";
  const family = (light: SubagentPillColors, night: SubagentPillColors): SubagentPillColors =>
    dark ? night : light;
  switch (tone) {
    case "running":
      return family(
        { surface: palette.sky50, border: palette.sky200, text: palette.sky700 },
        {
          surface: withAlpha(palette.sky950, 0.4),
          border: withAlpha(palette.sky900, 0.6),
          text: palette.sky300,
        },
      );
    case "success":
      return family(
        { surface: palette.emerald50, border: palette.emerald200, text: palette.emerald700 },
        {
          surface: withAlpha(palette.emerald950, 0.4),
          border: withAlpha(palette.emerald900, 0.6),
          text: palette.emerald300,
        },
      );
    case "cancelled":
      return {
        surface: desktop.cancelledSurface,
        border: desktop.cancelledBorder,
        text: desktop.cancelledSurfaceForeground,
      };
    case "destructive":
      return family(
        { surface: palette.rose50, border: palette.rose200, text: palette.rose700 },
        {
          surface: withAlpha(palette.rose950, 0.4),
          border: withAlpha(palette.rose900, 0.6),
          text: palette.rose300,
        },
      );
    case "warning":
      return family(
        { surface: palette.amber50, border: palette.amber200, text: palette.amber700 },
        {
          surface: withAlpha(palette.amber950, 0.3),
          border: withAlpha(palette.amber800, 0.7),
          text: palette.amber300,
        },
      );
    case "pending":
      return family(
        { surface: palette.amber50, border: palette.amber200, text: palette.amber700 },
        {
          surface: withAlpha(palette.amber950, 0.4),
          border: withAlpha(palette.amber900, 0.6),
          text: palette.amber300,
        },
      );
  }
};
