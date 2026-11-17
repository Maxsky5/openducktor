import type { AppPlatform } from "@openducktor/contracts";
import { hasPlatformModifier, platformKeyLabels } from "@/lib/keyboard-shortcuts";
import type { CommandPaletteHint } from "./command-palette-footer";
import type { PaletteEntry } from "./command-palette-groups";
import type { PaletteTaskCommand, PaletteTaskView } from "./command-palette-task-model";
import type {
  PaletteAction,
  PaletteChat,
  PaletteRowAction,
  PaletteTask,
} from "./command-palette-types";
import type { PaletteRowEntry } from "./use-command-palette-navigation";

type PaletteKeyEvent = Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">;

/** One palette key. Its footer hint and its key run the same handler. */
type PaletteKeyBinding = {
  matches: (event: PaletteKeyEvent) => boolean;
  run: () => void;
  /** The footer hint, or null for a second key of a command that already has a hint. */
  hint: Omit<CommandPaletteHint, "run"> | null;
};

/** Keys of the highlighted row, and keys of the whole palette. Each part has its footer side. */
type PaletteKeyBindings = { item: PaletteKeyBinding[]; palette: PaletteKeyBinding[] };

/** Hints of the highlighted row on the left, and hints of the palette on the right. */
type PaletteFooterHints = { itemHints: CommandPaletteHint[]; paletteHints: CommandPaletteHint[] };

type MainListKeyArgs = {
  platform: AppPlatform | null;
  /** The highlighted row of the main list. */
  entry: PaletteEntry | undefined;
  /** The task view of a highlighted task row. */
  taskView: PaletteTaskView | null;
  runTaskCommand: (
    task: PaletteTask,
    command: PaletteTaskCommand,
    taskView: PaletteTaskView,
  ) => void;
  renameChat: (chat: PaletteChat) => void;
  showActions: (entry: PaletteRowEntry) => void;
  caretAtEnd: () => boolean;
  openScope: () => void;
};

/** The keys of the open list. A row action list has its own keys. */
export const paletteKeyBindings = ({
  rowListOpen,
  query,
  back,
  ...mainList
}: MainListKeyArgs & {
  rowListOpen: boolean;
  query: string;
  back: () => void;
}): PaletteKeyBindings => (rowListOpen ? rowListBindings(query, back) : mainListBindings(mainList));

/** Run the binding of a key. Tab never moves focus out of the palette. */
export const handlePaletteKeyDown = (
  event: PaletteKeyEvent & { preventDefault: () => void },
  bindings: PaletteKeyBindings,
): void => {
  if (
    event.key === "Tab" ||
    (event.key === "Enter" && (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey))
  )
    event.preventDefault();
  const binding = [...bindings.item, ...bindings.palette].find((entry) => entry.matches(event));
  if (!binding) return;
  event.preventDefault();
  binding.run();
};

/** What Enter does on the highlighted row of the main list, or null when it does nothing. */
export const mainListEnterHint = ({
  entry,
  taskView,
  createFromQuery,
  highlightedValue,
  openTask,
  openChat,
  runAction,
}: {
  entry: PaletteEntry | undefined;
  taskView: PaletteTaskView | null;
  createFromQuery: PaletteAction | null;
  highlightedValue: string;
  openTask: (task: PaletteTask) => void;
  openChat: (chat: PaletteChat) => void;
  runAction: (action: PaletteAction) => void;
}): CommandPaletteHint | null => {
  switch (entry?.kind) {
    case "task": {
      const open = taskView?.open;
      if (!open) return null;
      const label =
        open.kind === "open_session"
          ? `Open ${entry.item.task.taskWorkflow.role(open.session.role).label} session`
          : "Open details";
      return enterHint(label, () => openTask(entry.item));
    }
    case "chat":
      return enterHint("Open session", () => openChat(entry.item));
    case "action":
      return enterHint("Run", () => runAction(entry.item));
    case undefined:
      return createFromQuery && highlightedValue === createFromQuery.key
        ? enterHint("Run", () => runAction(createFromQuery))
        : null;
  }
};

export const rowListEnterHint = (action: PaletteRowAction | undefined): CommandPaletteHint | null =>
  action ? enterHint("Run", action.run) : null;

/** The footer hints. Escape returns from a row action list and closes the main list. */
export const paletteFooterHints = ({
  bindings,
  rowListOpen,
  back,
  close,
}: {
  bindings: PaletteKeyBindings;
  rowListOpen: boolean;
  back: () => void;
  close: () => void;
}): PaletteFooterHints => ({
  itemHints: bindingHints(bindings.item),
  paletteHints: [
    ...bindingHints(bindings.palette),
    rowListOpen
      ? { id: "back", keys: ["Esc"], label: "Back", run: back }
      : { id: "close", keys: ["Esc"], label: "Close", run: close },
  ],
});

/** The key caps of the key that opens the scope list. */
export const scopeKeys = (platform: AppPlatform): string[] => [
  platformKeyLabels(platform).alt,
  "↓",
];

/** Fixed navigation of the highlighted record and workspace scope. */
const mainListBindings = ({
  platform,
  entry,
  showActions,
  caretAtEnd,
  openScope,
}: MainListKeyArgs): PaletteKeyBindings => {
  if (!platform) return { item: [], palette: [] };
  const item: PaletteKeyBinding[] = [];
  if (entry?.kind === "task" || entry?.kind === "chat")
    item.push(...actionListKeys(entry, showActions, caretAtEnd));
  const scope: PaletteKeyBinding = {
    matches: (event) =>
      event.key === "ArrowDown" &&
      event.altKey &&
      !event.shiftKey &&
      !hasPlatformModifier(event, platform),
    run: openScope,
    hint: { id: "scope", keys: scopeKeys(platform), label: "Workspace" },
  };
  return { item, palette: [scope] };
};

/** Tab and Right arrow open the action list of a task or chat row. */
const actionListKeys = (
  entry: PaletteRowEntry,
  showActions: (entry: PaletteRowEntry) => void,
  caretAtEnd: () => boolean,
): PaletteKeyBinding[] => [
  {
    matches: (event) => event.key === "Tab" && isPlain(event),
    run: () => showActions(entry),
    hint: { id: "actions", keys: ["Tab"], label: "Actions" },
  },
  {
    matches: (event) => event.key === "ArrowRight" && isPlain(event) && caretAtEnd(),
    run: () => showActions(entry),
    hint: null,
  },
];

/** A row action list: Backspace in an empty input returns to the main list. */
const rowListBindings = (query: string, back: () => void): PaletteKeyBindings => ({
  item: [{ matches: (event) => event.key === "Backspace" && query === "", run: back, hint: null }],
  palette: [],
});

const bindingHints = (bindings: readonly PaletteKeyBinding[]): CommandPaletteHint[] =>
  bindings.flatMap(({ hint, run }) => (hint ? [{ ...hint, run }] : []));

const enterHint = (label: string, run: () => void): CommandPaletteHint => ({
  id: "enter",
  keys: ["↵"],
  label,
  run,
});

const isPlain = (event: PaletteKeyEvent): boolean =>
  !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
