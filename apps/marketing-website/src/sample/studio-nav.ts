// The sidebar of the session windows. The sidebar groups the sessions by task, as the product
// does by default, so the story task shows one entry: its latest session. The markup holds one
// entry for each role, and the scenes show the entry of the session that runs.
import type { NavEntry } from "../replica/shell/nav";
import type { LaneId, RoleId } from "../replica/vocabulary";
import { CHAT, CHAT_SESSION } from "./chat";
import { NAV_SESSIONS } from "./nav";
import { TASKS } from "./tasks";
import { WORKSPACE } from "./workspace";

const story = { workspace: WORKSPACE, title: TASKS.k3x9.title, runtime: "codex" } as const;

/** The sessions of the story task, one entry for each role. */
export const STORY_SESSIONS = {
  spec: { ...story, id: "story-spec", role: "spec" },
  planner: { ...story, id: "story-planner", role: "planner" },
  build: { ...story, id: "story-build", role: "build" },
  qa: { ...story, id: "story-qa", role: "qa" },
} as const satisfies Record<RoleId, NavEntry>;

/** The other sessions of the workspace: a Builder that runs, and two older sessions. */
const OTHERS = [NAV_SESSIONS["sync-build"], NAV_SESSIONS["titles-spec"], NAV_SESSIONS["tags-chat"]];

/**
 * The entries of a frame: `latest` first, then the other sessions. The sessions of the story task
 * that the frame does not show wait hidden for the scenes. A closed task leaves the sidebar, so a
 * frame can have no story session.
 */
export function studioNav(latest?: NavEntry): readonly NavEntry[] {
  const waiting = Object.values(STORY_SESSIONS)
    .filter((entry) => entry.id !== latest?.id)
    .map((entry) => ({ ...entry, later: true }));
  return [...(latest ? [latest] : []), ...OTHERS, ...waiting];
}

/** The selected session of the story task after its turn, `time` ago: settled, read, and done. */
export function settled(role: RoleId, status: LaneId, time = "now"): NavEntry {
  return { ...STORY_SESSIONS[role], status, tone: "done", time, selected: true };
}

/** The chat of the chat view, a session without a task. */
export const CHAT_ENTRY = {
  workspace: WORKSPACE,
  id: "plan-chat",
  title: CHAT.title,
  runtime: CHAT_SESSION.runtime,
} as const satisfies NavEntry;
