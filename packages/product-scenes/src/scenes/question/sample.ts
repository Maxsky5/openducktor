// The sample data of the question scene. The Spec session of the search shortcut task waits for
// your answers in Needs you, and the Builder of the offline sync task runs. The sidebar groups the
// sessions by task, so each task shows one entry.
import type { NavEntry } from "../../replicas/shell/nav";
import type { CallData, Row } from "../../replicas/transcript/model";
import { bash, call, catFile } from "../../sample/calls";
import { NAV_SESSIONS } from "../../sample/nav";
import type { Session } from "../../sample/sessions";
import { STORY_SESSIONS } from "../../sample/studio-nav";
import { storySessions } from "../../sample/transcripts";

/** The Spec session in Needs you. The task is still in Backlog. */
export const SPEC_ENTRY = {
  ...STORY_SESSIONS.spec,
  status: "open",
  attention: "Question",
} as const satisfies NavEntry;

/** The Builder session that shows when the scene starts. */
export const SYNC_ENTRY = NAV_SESSIONS["sync-build"];

/** The Builder of the offline sync task on Claude Code. */
export const SYNC_SESSION = {
  runtime: "claude",
  model: "claude-lyra-3",
  effort: "medium",
  window: 200_000,
  used: 22.6,
} satisfies Session;

const OTHERS = [NAV_SESSIONS["titles-planner"], NAV_SESSIONS["typing-qa"]] as const;

/** The first frame: the Builder session shows, and the Spec session waits in Needs you. */
export const START_NAV: readonly NavEntry[] = [
  SPEC_ENTRY,
  { ...SYNC_ENTRY, selected: true },
  ...OTHERS,
];

/** The frame of the markup: you opened the Spec session from Needs you. */
export const OPENED_NAV: readonly NavEntry[] = [
  { ...SPEC_ENTRY, selected: true },
  SYNC_ENTRY,
  ...OTHERS,
];

/** The rows of the Spec turn of the story. */
function specRows(): readonly Row[] {
  const turn = storySessions([{ id: "spec", turns: 1 }])[0]?.turns[0];
  if (!turn) throw new Error("The story has no Spec turn.");
  return turn.rows;
}

type UserRow = Extract<Row, { kind: "user" }>;
type QuestionRow = Extract<Row, { kind: "question" }>;

function userRow(id: string): UserRow {
  const row = specRows().find((item) => item.id === id);
  if (row?.kind !== "user") throw new Error(`The Spec turn has no user message ${id}.`);
  return row;
}

function callRow(id: string): CallData {
  const row = specRows().find((item) => item.id === id);
  if (row?.kind !== "call") throw new Error(`The Spec turn has no tool call ${id}.`);
  return row;
}

function questionRow(id: string): QuestionRow {
  const row = specRows().find((item) => item.id === id);
  if (row?.kind !== "question") throw new Error(`The Spec turn has no question tool ${id}.`);
  return row;
}

/** The kickoff message of the Spec session. */
export const KICKOFF_ROW = userRow("kickoff");

/** The calls that the Spec agent runs before it asks. They show as one tool run. */
export const READ_CALLS = ["read-task", "search", "read-dialog"].map(callRow);

/** The request_user_input row. Its answers show under it when you confirm them. */
export const QUESTION_ROW = questionRow("question");

/** The Builder of the offline sync task reads the client and runs the sync tests. */
export const SYNC_CALLS: readonly CallData[] = [
  call("read", {
    tool: "read",
    name: "Read",
    summary: "src/sync/sync-client.ts",
    file: true,
    duration: "11ms",
    time: "09:40:52 AM",
  }),
  bash("test", "bun test src/sync", "3.2s", "09:40:55 AM"),
];

/** The call of the Spec agent after your answers: it reads the app shell. */
export const NEXT_CALL = catFile("next", "src/app/app-shell.tsx", "9ms", "09:42:01 AM");
