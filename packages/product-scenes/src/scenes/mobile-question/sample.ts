// The sample data of the question scene of the mobile app. The Spec agent of the pin task runs on
// Codex. It reads how the note list sorts, the note type, the tests, the note menu, and the
// notebook view, then asks one Structured Question with request_user_input: in which order the
// pinned notes show. Codex gives each option a label and a description. The kickoff message is
// the built-in Spec kickoff prompt for the task. The rows of the turn fill the transcript above
// the question, so the kickoff message is out of view once the card goes, as in a real session.
// The times are fictional.
import type { RailStep } from "../../replicas/mobile/MobileRail";
import type { MobileCall } from "../../replicas/mobile/ToolRun";
import type { NavEntry } from "../../replicas/shell/nav";
import type { Question } from "../../replicas/transcript/model";
import type { RoleId } from "../../replicas/vocabulary";
import { codexCommand } from "../../sample/mobile";
import { NAV_SESSIONS } from "../../sample/nav";
import { KICKOFF, SPEC_SESSION, TASK_ID } from "../../sample/studio";
import { TASKS } from "../../sample/tasks";
import { taskId, WORKSPACE } from "../../sample/workspace";

export const TASK = "w1j5" as const;
export const TITLE = TASKS[TASK].title;

/** The steps of the step list, one for each part of the scene. */
export const STEPS = [
  "A red badge on Sessions shows that a session needs you.",
  "Tap the session in Needs you to open it.",
  "Read the question of the agent. Then tap an answer.",
  "Tap Confirm Answers to send your answer.",
  "The agent gets your answer and continues its work.",
] as const;

/** The Spec session of the pin task. The task is still in Backlog. */
export const PIN_SPEC = "pin-spec";

const SPEC_ENTRY = {
  id: PIN_SPEC,
  workspace: WORKSPACE,
  title: TITLE,
  runtime: "codex",
  role: "spec",
  status: "open",
  tone: "in_progress",
  running: true,
} as const satisfies NavEntry;

/** The sessions of every open workspace in the order of their groups, with `spec` first. */
const sessionsWith = (spec: NavEntry): readonly NavEntry[] => [
  spec,
  NAV_SESSIONS["shortcut-build"],
  NAV_SESSIONS["focus-qa"],
  NAV_SESSIONS["sync-build"],
  NAV_SESSIONS["titles-spec"],
  NAV_SESSIONS["typing-qa"],
  NAV_SESSIONS["tags-chat"],
  NAV_SESSIONS["theme-plan"],
];

/** The first frame: the Spec session waits for an answer in Needs you. */
export const START_SESSIONS = sessionsWith({ ...SPEC_ENTRY, attention: "Question", unread: true });

/** The last frame: the Spec session runs again after the answer. */
export const LAST_SESSIONS = sessionsWith(SPEC_ENTRY);

/** The Spec session on Codex, early in its context window. */
export const PIN_SPEC_SESSION = { ...SPEC_SESSION, used: 6.2 };

/** The kickoff message of the Spec session, with the id of the pin task. */
export const KICKOFF_MESSAGE = {
  text: KICKOFF.spec.replaceAll(TASK_ID, taskId(TASK)),
  time: "9:50:02 AM",
} as const;

/** The tool calls of the turn, in order. Codex runs its file lookups as shell commands. */
export const TOOLS = {
  guide: codexCommand("read", "cat AGENTS.md", "16ms", "9:50:05 AM"),
  search: codexCommand("search", 'rg -n "pinned|sortNotes" src', "71ms", "9:50:07 AM"),
  folder: codexCommand("list", "ls src/notes", "12ms", "9:50:08 AM"),
  list: codexCommand("read", "sed -n '1,140p' src/notes/note-list.tsx", "18ms", "9:50:11 AM"),
  sort: codexCommand("read", "cat src/notes/sort-notes.ts", "14ms", "9:50:12 AM"),
  type: codexCommand("read", "cat src/notes/note.ts", "13ms", "9:50:15 AM"),
  tests: codexCommand("search", 'rg -n "sortNotes" test', "64ms", "9:50:16 AM"),
  menu: codexCommand("read", "sed -n '1,90p' src/notes/note-menu.tsx", "17ms", "9:50:19 AM"),
  notebook: codexCommand(
    "read",
    "sed -n '1,120p' src/notebooks/notebook-view.tsx",
    "19ms",
    "9:50:22 AM",
  ),
  store: codexCommand("read", "cat src/notes/note-store.ts", "15ms", "9:51:21 AM"),
} as const satisfies Record<string, MobileCall>;

/**
 * The tool runs of the turn: consecutive calls make one run. A run that another row follows is
 * folded.
 */
export const RUNS = {
  lookups: ["guide", "search", "folder"],
  reads: ["list", "sort"],
  checks: ["type", "tests"],
  menu: ["menu"],
  view: ["notebook"],
  store: ["store"],
} as const satisfies Record<string, readonly (keyof typeof TOOLS)[]>;

/** The messages of the Spec agent before it asks: the first one, then one after each run. */
export const NOTES = {
  intro: "I read the agent guide first, then I find where the app lists the notes.",
  plan: "Notes have no pin flag yet, so the spec must add one. Next, I check how the note list sorts and stores notes.",
  sorting:
    "`sort-notes.ts` sorts the notes by last edit. I check the note type and the tests next.",
  types:
    "Each note keeps only `updatedAt`, and the tests cover the edit order. No note or test knows about pins yet.",
  menu: "The note menu has Archive and Delete, so Pin goes there too.",
  findings: "Pinned notes need an order of their own.",
} as const;

/** The question of the Spec agent, and the answer that the visitor chooses. */
export const QUESTION = {
  header: "Pin order",
  question: "How should pins sort?",
  options: [
    { label: "Last pinned first", description: "A new pin goes above the older pins." },
    { label: "Last edited first", description: "Pins keep the sort of the notebook." },
    { label: "Drag to reorder", description: "People set the order by hand." },
  ],
  answer: "Last pinned first",
} as const satisfies Question;

/** The question tool call: its clock time, and the time until the answer came. */
export const QUESTION_CALL = { time: "9:50:25 AM", duration: "54s" } as const;

/** The reply of the Spec agent to the answer. */
export const REPLY =
  "The newest pin goes first. I add a `pinnedAt` time to each note and sort the pinned notes by it.";

/** The workflow rail of a task in Backlog while its Spec agent waits, and after the answer. */
export const RAIL = {
  waiting: {
    spec: { tone: "waiting_input", mark: "waiting" },
    planner: { tone: "blocked", mark: "none" },
    build: { tone: "blocked", mark: "none" },
    qa: { tone: "blocked", mark: "none" },
  },
  working: {
    spec: { tone: "in_progress", mark: "working" },
    planner: { tone: "blocked", mark: "none" },
    build: { tone: "blocked", mark: "none" },
    qa: { tone: "blocked", mark: "none" },
  },
} as const satisfies Record<string, Record<RoleId, RailStep>>;
