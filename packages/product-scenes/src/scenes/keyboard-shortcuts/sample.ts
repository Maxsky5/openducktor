// The sample data of the keyboard-shortcuts scene: the four sessions of the sidebar, the two chats
// that the visitor opens, the keys of each step on each platform, and the rows of Keyboard
// shortcuts that each search keeps. The chats, their messages, and the models are fictional.
import type { KeyPlatform } from "../../replicas/keys";
import type { RepositorySection } from "../../replicas/settings/RepositorySidebar";
import type { SettingsSection } from "../../replicas/settings/SettingsDialog";
import type { PlatformKeys, ShortcutCommand } from "../../replicas/settings/ShortcutRow";
import type { ShortcutGroup } from "../../replicas/settings/ShortcutSettings";
import type { SearchStep } from "../../replicas/settings/shortcut-settings";
import type { NavData, NavEntry } from "../../replicas/shell/nav";
import { NAV_SESSIONS } from "../../sample/nav";
import type { Session } from "../../sample/sessions";
import { WORKSPACE } from "../../sample/workspace";

/**
 * The section that Settings shows at its first open: INITIAL_NAVIGATION of
 * settings-modal-open-state.ts. Open Settings opens it with no deep link.
 */
export const FIRST_SECTION: SettingsSection = "Repositories";

/** The section of the repository settings at the first open. */
export const FIRST_REPOSITORY_SECTION: RepositorySection = "Configuration";

/** A chat of the scene: its row in the sidebar, its model, and its one turn. */
export type Chat = {
  entry: NavEntry;
  session: Session;
  message: string;
  time: string;
  worked: string;
  reply: string;
};

/** The chat that shows when the scene starts. It is the first row of the sidebar. */
export const FIRST: Chat = {
  entry: { ...NAV_SESSIONS["tags-chat"], time: "4m" },
  session: {
    runtime: "claude",
    model: "claude-lyra-3",
    effort: "high",
    window: 200_000,
    used: 6.1,
  },
  message: "Tags that I add offline are gone after the next sync. Find out why.",
  time: "10:20:58 AM",
  worked: "38s",
  reply:
    "The sync keeps the newer copy of each note, and a tag change does not update the time of the note. When the copy on the server is newer, it replaces the tags that you added offline. I can merge the tags of both copies when the sync runs.",
};

/** The chat that Mod 3 opens. It is the third row of the sidebar. */
export const THIRD: Chat = {
  entry: {
    workspace: WORKSPACE,
    id: "search-chat",
    title: "Make note search faster",
    runtime: "codex",
    time: "19m",
  },
  session: {
    runtime: "codex",
    model: "gpt-6-astra",
    effort: "medium",
    window: 400_000,
    used: 9.8,
    speed: "standard",
  },
  message: "Search takes two seconds in a notebook with 5,000 notes. Make it faster.",
  time: "10:05:31 AM",
  worked: "1m12s",
  reply:
    "Each query read every note from disk. A word index now builds when a notebook opens, so a query reads only the notes that match. Search takes 40 ms in the same notebook.",
};

/** The four sessions in Recent, newest first. Needs you and Running are empty. */
const entries = (selected: Chat): readonly NavEntry[] =>
  [FIRST.entry, NAV_SESSIONS["titles-spec"], THIRD.entry, NAV_SESSIONS["typing-qa"]].map(
    (entry) => ({ ...entry, selected: entry.id === selected.entry.id }),
  );

/** The sidebar when the scene starts: the first chat is open. The rows have position hints. */
export const START_NAV: NavData = { scope: "current", entries: entries(FIRST), hints: true };

/** The sidebar after Mod 3: the third chat is open. */
export const END_NAV: NavData = { ...START_NAV, entries: entries(THIRD) };

/** The keys of each step, as shortcutKeyParts and modifierKeyParts of key-labels.ts write them. */
export type StepKeys = {
  /** Mod: Command on macOS and Control elsewhere. */
  mod: string;
  /** The default keys of Open Settings: chord(",", CTRL) of catalogue.ts. */
  settings: readonly string[];
  /** The modifiers that are down while the visitor records: Mod, then Mod and Shift. */
  recording: readonly (readonly string[])[];
  /** The keys that the recorder takes: Mod Shift F. */
  recorded: readonly string[];
  /** The keys in words for the text of the view, as spokenShortcut of key-labels.ts says them. */
  words: { mod: string; settings: string; recorded: string };
};

export const STEP_KEYS = {
  mac: {
    mod: "⌘",
    settings: ["⌃", ","],
    recording: [["⌘"], ["⇧", "⌘"]],
    recorded: ["⇧", "⌘", "F"],
    words: { mod: "Command", settings: "Control and comma", recorded: "Shift Command F" },
  },
  pc: {
    mod: "Ctrl",
    settings: ["Ctrl", ","],
    recording: [["Ctrl"], ["Ctrl", "Shift"]],
    recorded: ["Ctrl", "Shift", "F"],
    words: { mod: "Ctrl", settings: "Ctrl and comma", recorded: "Ctrl Shift F" },
  },
} as const satisfies Record<KeyPlatform, StepKeys>;

/** The digit that opens the third session: the default keys of session-position-3 are Mod 3. */
export const JUMP_DIGIT = "3";

/** A command of the list. */
const command = (
  id: string,
  label: string,
  when: string,
  picker: boolean,
  keys: PlatformKeys | null,
): ShortcutCommand => ({ id, label, when, picker, keys });

const ALWAYS = "Always";
const NOT_TYPING = "Not while typing";
const BROWSER = "A browser tab has focus";

/**
 * Every row that the scene shows, by group, in the order of the app. Each search step shows some
 * of them. The labels, the When lines, and the keys are those of catalogue.ts with no change.
 */
export const GROUPS: readonly ShortcutGroup[] = [
  {
    group: "App",
    commands: [
      command("palette", "Toggle command palette", ALWAYS, false, {
        mac: ["⌘", "K"],
        pc: ["Ctrl", "K"],
      }),
      command("settings", "Open Settings", ALWAYS, true, {
        mac: STEP_KEYS.mac.settings,
        pc: STEP_KEYS.pc.settings,
      }),
      command("sidebar", "Toggle sidebar", ALWAYS, true, { mac: ["⌃", "B"], pc: ["Ctrl", "B"] }),
      command("diagnostics", "Open diagnostics", NOT_TYPING, true, null),
      command("feature-tour", "Show tour", NOT_TYPING, true, null),
      command("open-repository", "Open repository", NOT_TYPING, true, null),
    ],
  },
  {
    group: "Settings",
    commands: [command("settings:notifications", "Notifications", NOT_TYPING, true, null)],
  },
  {
    group: "Workspace",
    commands: [
      command("new-chat", "New session", ALWAYS, true, {
        mac: ["⌃", "⇧", "O"],
        pc: ["Ctrl", "Shift", "O"],
      }),
      command("import-chat", "Import session from an external runtime", NOT_TYPING, true, null),
      command("refresh-tasks", "Refresh tasks", NOT_TYPING, true, null),
    ],
  },
  {
    group: "Navigation",
    commands: [
      command("focus-task-search", "Focus task search", ALWAYS, true, {
        mac: ["⌘", "F"],
        pc: ["Ctrl", "F"],
      }),
    ],
  },
  {
    group: "Session",
    commands: [
      command("focus-composer", "Focus composer", ALWAYS, true, {
        mac: ["⌃", "I"],
        pc: ["Ctrl", "I"],
      }),
    ],
  },
  {
    group: "Browser",
    commands: [
      command("browser-forward", "Browser forward", BROWSER, false, null),
      command("browser-address", "Focus address", BROWSER, false, null),
      command("download-reveal", "Show download in folder", BROWSER, false, null),
    ],
  },
  {
    group: "Content",
    commands: [command("message-fork", "Fork from message", "An item has focus", false, null)],
  },
];

/** The text that the visitor types in the search. */
export const SEARCH = "fork";

/**
 * The rows of the list for the empty search and after each letter of SEARCH, from the top. Each
 * list starts as the list of the app and goes past the bottom of the pane.
 */
export const SEARCH_STEPS: readonly SearchStep[] = [
  {
    term: "",
    commands: ["palette", "settings", "sidebar", "diagnostics", "feature-tour", "open-repository"],
  },
  {
    term: "f",
    commands: [
      "settings:notifications",
      "new-chat",
      "import-chat",
      "refresh-tasks",
      "focus-task-search",
    ],
  },
  {
    term: "fo",
    commands: [
      "focus-task-search",
      "focus-composer",
      "browser-forward",
      "browser-address",
      "download-reveal",
      "message-fork",
    ],
  },
  { term: "for", commands: ["browser-forward", "message-fork"] },
  { term: SEARCH, commands: ["message-fork"] },
];

/** The command that the visitor gives keys, and its new keys: Mod Shift F. */
export const RECORDED = {
  id: "message-fork",
  keys: { mac: STEP_KEYS.mac.recorded, pc: STEP_KEYS.pc.recorded },
} as const satisfies { id: string; keys: PlatformKeys };
