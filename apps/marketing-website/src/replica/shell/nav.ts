// The session list of the sidebar: session-navigation-list.tsx and session-navigation-rail.tsx
// show the same entries in three groups. Sources: session-navigation-read-model.ts for the groups,
// session-navigation-parts.tsx for the dot and the attention pills, and
// workspace-rail-activity-badges-model.ts for the badges of the workspace rail.
import type { RuntimeKind } from "../../sample/models";
import type { WorkspaceName } from "../../sample/workspace";
import type { DotState, LaneId, RoleId } from "../vocabulary";

/** The groups in the order of the list. */
const NAV_GROUPS = ["needs_you", "running", "recent"] as const;
export type NavGroupId = (typeof NAV_GROUPS)[number];

const NAV_GROUP_LABELS = {
  needs_you: "Needs you",
  running: "Running",
  recent: "Recent",
} satisfies Record<NavGroupId, string>;

/** The workflow tone of a task session, which colors its role icon as the workflow rail does. */
export type NavTone = "in_progress" | "done" | "available" | "rejected" | "waiting_input";

/** Why a session needs you. */
export type Attention = "Question" | "Permission" | "Blocked";

/** A session in the list: a task session with its role, or a chat. */
export type NavEntry = {
  /** The name that the scenes use to find the entry. */
  id: string;
  workspace: WorkspaceName;
  title: string;
  runtime: RuntimeKind;
  /** A task session. A chat has no role, no task status, and no tone. */
  role?: RoleId;
  status?: LaneId;
  tone?: NavTone;
  /** A scene clears the attention when you answer. */
  attention?: Attention | undefined;
  running?: boolean;
  unread?: boolean;
  /** The short time of a settled session, such as 6m. */
  time?: string;
  selected?: boolean;
  /** The session runs a repository action or another command in a terminal. */
  commands?: boolean;
  /** The session does not show yet, or no longer shows, so the markup hides it. */
  later?: boolean;
};

/** The fields of an entry that a scene changes. */
export type NavPatch = Partial<Omit<NavEntry, "id" | "workspace" | "title" | "runtime" | "role">>;

/** A session that needs you goes first, then a running session. The others are recent. */
export function navGroup(entry: NavEntry): NavGroupId {
  if (entry.attention) return "needs_you";
  return entry.running ? "running" : "recent";
}

/** A group of the list. Needs you and Running show also when they are empty. */
export type NavGroupView = {
  group: NavGroupId;
  label: string;
  entries: NavEntry[];
  /** The number of entries that show. A later entry does not count. */
  count: number;
  hidden: boolean;
};

/** The groups of the list, with their entries in the order of `entries`. */
export function navGroupViews(entries: readonly NavEntry[]): NavGroupView[] {
  return NAV_GROUPS.map((group) => {
    const members = entries.filter((entry) => navGroup(entry) === group);
    const count = members.filter((entry) => !entry.later).length;
    const hidden = group === "recent" && count === 0;
    return { group, label: NAV_GROUP_LABELS[group], entries: members, count, hidden };
  });
}

/** The dot of an entry. Attention comes first, then a running session, then the read state. */
export function navDot(entry: NavEntry): DotState {
  if (entry.attention) return entry.unread === false ? "input-read" : "input";
  if (entry.running) return "running";
  return entry.unread ? "unread" : "read";
}

/** The color of the row icon: attention first, then the workflow tone, then a running chat. */
export function navTone(entry: NavEntry): NavTone | undefined {
  if (entry.attention) return "waiting_input";
  if (entry.tone) return entry.tone;
  return entry.running ? "in_progress" : undefined;
}

/** The time of a row. A session that needs you or runs shows no time. */
export function navTime(entry: NavEntry): string | undefined {
  return entry.attention || entry.running ? undefined : entry.time;
}

/** The sessions of the sidebar, and the scope of the list. */
export type NavData = { scope: "current" | "all"; entries: readonly NavEntry[] };

/** The badges of a workspace tile: a session waits for input, or a session runs. */
export type RailBadges = { input: boolean; running: boolean };

/**
 * The badges of the tile of `workspace`. A session that waits does not count as running. The
 * sample has no session outside the lists, so the badges follow the entries that show.
 */
export function railBadges(entries: readonly NavEntry[], workspace: WorkspaceName): RailBadges {
  const shown = entries.filter((entry) => !entry.later && entry.workspace === workspace);
  return {
    input: shown.some((entry) => entry.attention),
    running: shown.some((entry) => entry.running && !entry.attention),
  };
}
