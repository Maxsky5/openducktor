// The steps that each chapter of the workflow repeats: you start a session from the quick
// action, the agent saves its document, and the turn ends. The sidebar groups the sessions by
// task, so the entry of the story task follows its latest session.
import type { Attention, NavTone } from "../../replica/shell/nav";
import type { Studio, StudioChange } from "../../replica/studio/studio";
import type { LaneId, RoleId } from "../../replica/vocabulary";
import type { Session } from "../../sample/sessions";
import { STORY_SESSIONS } from "../../sample/studio-nav";
import type { SessionId } from "../../sample/transcripts";

/**
 * The sidebar entry of the story task shows the session of `role`, which runs and is selected.
 * The entry of the session before it leaves the list.
 */
export function runSession(
  studio: Studio,
  at: number,
  role: RoleId,
  status: LaneId,
  previous?: RoleId,
): void {
  if (previous && previous !== role) studio.sessions.hide(STORY_SESSIONS[previous].id, at);
  studio.sessions.update(STORY_SESSIONS[role].id, at, {
    status,
    tone: "in_progress",
    running: true,
    attention: undefined,
    selected: true,
  });
}

/** The session of `role` stops for your answer: its entry moves to Needs you. */
export function waitSession(studio: Studio, at: number, role: RoleId, attention: Attention): void {
  studio.sessions.update(STORY_SESSIONS[role].id, at, { attention, running: false });
}

/** The turn of the session of `role` ends: its entry settles in Recent, read, as you watch it. */
export function settleSession(studio: Studio, at: number, role: RoleId, tone: NavTone): void {
  studio.sessions.update(STORY_SESSIONS[role].id, at, { tone, running: false, time: "now" });
}

/**
 * You click the quick action and start a session in the start dialog of template `dialog`. The
 * window changes to the new session. Returns the time when the session starts.
 */
export function startSession<Template extends string>(
  studio: Studio<Template>,
  at: number,
  dialog: Template,
  change: StudioChange,
  session?: SessionId,
): number {
  const clicked = studio.quickAction(at);
  const started = studio.requests.startSession(dialog, clicked + 0.3);
  studio.cursor.hide(started);
  if (session) studio.switchSession(session, started);
  studio.patch(started, { activity: "working", ...change });
  return started;
}

/**
 * The agent saves its document with the workflow card `row`, and the document panel fills. A
 * narrow window shows the panel for `reading` seconds. Returns the time of the save.
 */
export function saveDocument(
  studio: Studio,
  row: HTMLElement,
  at: number,
  updated: string,
  change: StudioChange,
  reading: number,
): number {
  const saved = studio.rows.workflow(row, at, 0.6);
  studio.panels.fill(updated, saved);
  studio.patch(saved, change);
  showPanel(studio, saved + 0.1, reading);
  return saved;
}

/** A narrow window shows one column. The panel shows for `seconds`, then the chat again. */
export function showPanel(studio: Studio, at: number, seconds: number): void {
  studio.patch(at, { focus: "panel" });
  studio.patch(at + seconds, { focus: "chat" });
}

/** The context use of a turn: from `from` percent at `since` to the use of `session` at its end. */
export type TurnContext = { session: Session; from: number; since: number };

/**
 * The agent streams the message `row`, and the turn ends. The context meter fills during the
 * turn. Returns the end time.
 */
export function endTurn(
  studio: Studio,
  row: HTMLElement,
  at: number,
  change: StudioChange,
  context: TurnContext,
): number {
  const end = studio.rows.say(row, at);
  studio.patch(end, { activity: "idle", ...change });
  studio.context(context.session, context.from, context.since, end);
  return end;
}
