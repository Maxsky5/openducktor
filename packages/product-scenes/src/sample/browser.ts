// Sample data of the browser, annotate, and agent browser scenes: the task, the dev server of the
// Fieldnotes app, and the last answer of the Builder before the scenes start. The task asks for a
// better empty notebook, so the Builder serves the app, and the Builder and the developer check it
// in a browser tab.
import type { TaskKey } from "./tasks";

export const BROWSER_TASK: TaskKey = "p6d4";

/** The address that the developer types, and the address bar after the page loads. */
export const DEV_SERVER = "http://localhost:5173";
export const DEV_SERVER_SHORT = "localhost:5173";

/** The title of the page, which the tab shows after the page loads. */
export const PAGE_TITLE = "Fieldnotes";

/** The label of a browser tab before it has an address: browserPageLabel in the app. */
export const BLANK_PAGE = "Blank page";

/** The time that the last answer of the Builder took. */
export const BUILDER_WORKED = "3m 12s";

/** The last answer of the Builder. Backticks mark the inline code. */
export const BUILDER_REPLY =
  "The empty Travel notebook now explains what to do, with a Create a note button. `bun run dev` serves the app on port 5173.";

/** The placeholder of an empty address bar: BROWSER_ADDRESS_PLACEHOLDER in the app. */
export const BROWSER_ADDRESS_PLACEHOLDER = "Type a web address";

/** The new tab page of a tab with no address: browser-new-tab-view.tsx. */
export const NEW_TAB_PAGE = {
  title: "Open a page",
  empty: "The pages that you open in this workspace show here.",
} as const;

/** The badge of a user tab that agents can use: PANEL_TAB_BADGE_LABELS.shared in the app. */
export const SHARED_BADGE = "Shared";

/** The label of a new tab before it opens a kind: NEW_TAB_LABEL in the app. */
export const NEW_TAB_LABEL = "New tab";

/** The badge of a tab that an agent opened: PANEL_TAB_BADGE_LABELS.agent in the app. */
export const AGENT_BADGE = "Agent";
