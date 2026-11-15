import {
  type AppPlatform,
  sameShortcut,
  type ShortcutActionId,
  type ShortcutCombination,
  type ShortcutPreferences,
} from "@openducktor/contracts";
import { shortcutKeyParts } from "@openducktor/frontend-core/shortcuts/key-labels";
import {
  compileShortcuts,
  effectiveShortcut,
  type ShortcutCommandDefinition,
  type ShortcutShell,
} from "@/features/shortcuts/catalogue";

/** "in-use" lists commands with keys; "all" lists every command. Search always covers all. */
export type ShortcutFilter = "in-use" | "all";

/** One command as Settings shows it on this device. */
export type ShortcutCommandView = {
  entry: ShortcutCommandDefinition;
  label: string;
  /** Undefined until the preferences load. */
  current: ShortcutCombination | null | undefined;
  defaultKeys: ShortcutCombination | null;
  customized: boolean;
  /** Why the saved assignment does not run on this device. */
  inactiveReason: string | undefined;
  search: string;
};
export type ShortcutFamily = {
  key: "session" | "workspace";
  label: string;
  commands: ShortcutCommandView[];
};
export type ShortcutGroupItem =
  | { kind: "command"; command: ShortcutCommandView }
  | { kind: "family"; family: ShortcutFamily };

const FAMILY_LABELS = { session: "Go to session 1–10", workspace: "Go to workspace 1–10" };
const POSITION_PATTERN = /^(session|workspace)-position-\d+$/;
const MAC_KEY_WORDS = new Map([
  ["⌘", "cmd command"],
  ["⌃", "ctrl control"],
  ["⌥", "opt option alt"],
  ["⇧", "shift"],
  ["↵", "enter return"],
]);

/** Lower case with spaces and plus signs folded, so "Ctrl+B" and "ctrl b" match. */
export const searchKey = (value: string) =>
  value
    .toLowerCase()
    .replace(/[\s+]+/g, " ")
    .trim();

/** Words a user may type to find a command by its keys, such as "cmd k" or "ctrl+b". */
const keySearchText = (combination: ShortcutCombination | null, platform: AppPlatform) => {
  if (!combination) return "";
  const parts = shortcutKeyParts(combination, platform);
  const words = parts.map((part) => MAC_KEY_WORDS.get(part) ?? part);
  return [parts.join(""), parts.join("+"), parts.join(" "), words.join(" ")].join(" ");
};

/** Overrides that equal the default are removed, so "Changed" lists only real changes. */
export const withAssignment = (
  preferences: ShortcutPreferences,
  id: ShortcutActionId,
  combination: ShortcutCombination | null,
  defaultKeys: ShortcutCombination | null,
): ShortcutPreferences => {
  const overrides = { ...preferences.overrides };
  if (sameShortcut(combination, defaultKeys)) delete overrides[id];
  else overrides[id] = combination;
  return { version: 1, overrides };
};

export const buildCommandViews = (
  catalogue: readonly ShortcutCommandDefinition[],
  preferences: ShortcutPreferences | undefined,
  platform: AppPlatform,
  shell: ShortcutShell,
): ShortcutCommandView[] => {
  const compiled = preferences ? compileShortcuts(preferences, catalogue, platform, shell) : null;
  return catalogue.map((entry) => {
    const current = preferences ? effectiveShortcut(entry, preferences, shell) : undefined;
    return {
      entry,
      label: entry.label.startsWith(`${entry.group}: `)
        ? entry.label.slice(entry.group.length + 2)
        : entry.label,
      current,
      defaultKeys: entry.defaultKeys[shell],
      customized: Boolean(preferences && Object.hasOwn(preferences.overrides, entry.id)),
      inactiveReason: compiled?.problems.get(entry.id)?.message,
      search: searchKey(
        `${entry.label} ${entry.group} ${keySearchText(current ?? null, platform)}`,
      ),
    };
  });
};

/**
 * The visible commands by group. Without a search, the ten positions of each list fold into one
 * family row.
 */
export const groupCommandViews = (
  views: readonly ShortcutCommandView[],
  filter: ShortcutFilter,
  term: string,
  /** A command whose keys were just removed; it keeps its place so its Undo stays put. */
  kept: ShortcutActionId | null = null,
): Map<string, ShortcutGroupItem[]> => {
  const fold = term === "";
  const groups = new Map<string, ShortcutGroupItem[]>();
  for (const view of views) {
    const hidden = term
      ? !view.search.includes(term)
      : filter === "in-use" && !view.current && view.entry.id !== kept;
    if (hidden) continue;
    const items = groups.get(view.entry.group) ?? [];
    groups.set(view.entry.group, items);
    const family = fold && POSITION_PATTERN.test(view.entry.id) ? familyKey(view) : null;
    if (!family) {
      items.push({ kind: "command", command: view });
      continue;
    }
    const existing = items.find((item) => item.kind === "family" && item.family.key === family);
    if (existing?.kind === "family") existing.family.commands.push(view);
    else
      items.push({
        kind: "family",
        family: { key: family, label: FAMILY_LABELS[family], commands: [view] },
      });
  }
  // Commands with keys come first in each group, so the list reads like a cheat sheet.
  const hasKeys = (item: ShortcutGroupItem) =>
    item.kind === "family" || Boolean(item.command.current);
  for (const items of groups.values())
    items.sort((left, right) => Number(hasKeys(right)) - Number(hasKeys(left)));
  return groups;
};

const familyKey = (view: ShortcutCommandView): ShortcutFamily["key"] =>
  view.entry.id.startsWith("session-") ? "session" : "workspace";
