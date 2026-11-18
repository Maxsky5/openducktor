// The sample data of the artifacts scene: the Builder session of the sample task, which saves an
// HTML wireframe of the search dialog on the task, and the artifacts of the task in the Artifacts tab.
// The Spec and the Planner saved their documents a few minutes before, as in the workflow story.
// The times are fictional.
import type { ArtifactEntry, ArtifactGroups, StudioFrame } from "../../replicas/studio/model";
import type { Session } from "../../sample/sessions";
import { ARTIFACTS, BUILDER_SESSION } from "../../sample/studio";
import { STORY_SESSIONS, settled, studioNav } from "../../sample/studio-nav";

/** The Builder session at the start of its work, with little of its context in use. */
export const SESSION = { ...BUILDER_SESSION, used: 6.4 } satisfies Session;

/**
 * The last frame of the session window: the Builder ended its turn, and the task is in progress. A
 * narrow stage shows the Artifacts tab.
 */
export const FRAME = {
  tones: ["done", "done", "in_progress", "blocked"],
  selected: "build",
  action: "Start Implementation",
  actionDisabled: false,
  session: SESSION,
  panel: "document",
  checksTab: false,
  focus: "panel",
  nav: studioNav(settled("build", "in_progress")),
} as const satisfies StudioFrame;

/** The first frame: the Builder works on its turn, and a narrow stage shows the chat. */
export const WORKING = {
  ...FRAME,
  focus: "chat",
  nav: studioNav({
    ...STORY_SESSIONS.build,
    status: "in_progress",
    tone: "in_progress",
    running: true,
    selected: true,
  }),
} as const satisfies StudioFrame;

/** The file that the Builder saves with odt_set_task_artifact: an HTML page of 6.2 KiB. */
export const MOCKUP = {
  id: "search-dialog-wireframe",
  name: "Search dialog wireframe",
  mediaType: "text/html",
  bytes: 6348,
  updated: "just now",
} satisfies ArtifactEntry;

/** The code of the file, which the Builder chooses, and its file name. */
export const MOCKUP_CODE = MOCKUP.id;
export const MOCKUP_FILE = "search-dialog-wireframe.html";

/** The collection after the save: the documents of the Spec and the Planner, then the wireframe. */
export const ARTIFACT_GROUPS = {
  workflow: [
    { id: "spec", name: ARTIFACTS.spec.title, mediaType: "text/markdown", updated: "5m ago" },
    { id: "plan", name: ARTIFACTS.plan.title, mediaType: "text/markdown", updated: "2m ago" },
  ],
  files: [MOCKUP],
} satisfies ArtifactGroups;

/** The message of the visitor. */
export const ASK =
  "Save a wireframe of the search dialog on the task first. I want to check the layout before you change the code.";

/** The reply of the Builder before the save. Backticks mark the inline code. */
export const INTRO =
  "I will draw the search dialog as a wireframe in one HTML page, with a note on each part.";

/** The last message of the turn. */
export const SAVED =
  "The wireframe is on the task as Search dialog wireframe. It shows the field with the `Cmd+K` hint, the recent notes, and the keys of the dialog. Tell me what to change before I edit `search-dialog.tsx`.";

/** The times of the message and of the save, and the time of the turn. */
export const TIMES = { ask: "09:47:02 AM", save: "09:47:31 AM" } as const;
export const SAVE_DURATION = "48ms";
export const WORKED = "41s";

/** The rows of the turn, which the scene shows one by one. */
export const TURN_ROWS = ["intro", "save", "saved"] as const;

/** The preview dialog that Expand opens. */
export type ArtifactsTemplate = "preview-dialog";
