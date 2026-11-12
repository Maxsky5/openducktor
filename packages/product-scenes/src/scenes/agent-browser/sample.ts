// The sample data of the agent browser scene: the request of the developer, the browser calls of
// the Builder, and its answer. The Builder checks its empty notebook in its own browser tab
// before the developer annotates the page in the annotate scene.
import { DEV_SERVER } from "../../sample/browser";

/** The message that asks for the check, and the time of the message. */
export const CHECK_MESSAGE = "Check the empty Travel notebook in the browser.";
export const MESSAGE_TIME = "10:45:02 AM";

/** The first answer of the Builder, before its first browser call. */
export const PLAN_TEXT = "I open the dev server in a browser tab and check the Travel notebook.";

/** The text that the Builder types in the search field of the Fieldnotes app. */
export const SEARCH_QUERY = "Lisbon";

/** The ref that a snapshot gives to an element of the page. */
const REFS = { search: "e9", travel: "e14" } as const;

/** A browser call: its action, its input, its title in the card, its duration, and its time. */
export type BrowserCall = {
  action: string;
  input: Readonly<Record<string, string | boolean>>;
  /** The title of the card: browserToolTitle in browser-tool-summary.ts. */
  title: string;
  duration: string;
  time: string;
  /** The call saves a screenshot, so its card shows the Screenshot button. */
  screenshot: boolean;
};

/** The browser calls of the Builder, in their order. The tab id comes from the open call. */
export const CALLS = {
  open: {
    action: "open",
    input: { url: DEV_SERVER },
    title: `Open ${DEV_SERVER}`,
    duration: "1.3s",
    time: "10:45:07 AM",
    screenshot: false,
  },
  snapshot: {
    action: "snapshot",
    input: {},
    title: "Snapshot",
    duration: "190ms",
    time: "10:45:09 AM",
    screenshot: false,
  },
  type: {
    action: "type",
    input: { ref: REFS.search, text: SEARCH_QUERY, submit: true },
    title: `Type "${SEARCH_QUERY}" and press Enter`,
    duration: "1.1s",
    time: "10:45:12 AM",
    screenshot: false,
  },
  click: {
    action: "click",
    input: { ref: REFS.travel },
    title: `Click ${REFS.travel}`,
    duration: "410ms",
    time: "10:45:15 AM",
    screenshot: false,
  },
  screenshot: {
    action: "screenshot",
    input: {},
    title: "Screenshot page",
    duration: "1.4s",
    time: "10:45:17 AM",
    screenshot: true,
  },
} as const satisfies Record<string, BrowserCall>;

export type CallName = keyof typeof CALLS;

/** The calls in the order of the chat. */
export const CALL_ORDER = [
  "open",
  "snapshot",
  "type",
  "click",
  "screenshot",
] as const satisfies readonly CallName[];

/** The last answer of the Builder and the time of its turn. */
export const CHECK_REPLY = `The page works. Search finds the ${SEARCH_QUERY} note, and the empty Travel notebook shows its text and the Create a note button.`;
export const CHECK_WORKED = "19s";

/** The tooltip of the Agent badge in the toolbar of an agent tab: browser-toolbar.tsx. */
export const AGENT_BADGE_TIP = "An agent opened this tab. Agents can use it.";
