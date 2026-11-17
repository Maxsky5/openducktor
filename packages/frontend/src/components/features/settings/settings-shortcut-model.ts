import {
  type AppPlatform,
  sameShortcut,
  type ShortcutActionId,
  type ShortcutCombination,
  type ShortcutPreferences,
  type ShortcutWhen,
} from "@openducktor/contracts";
import { shortcutKeyParts } from "@openducktor/frontend-core/shortcuts/key-labels";
import { compileShortcuts } from "@/features/shortcuts/compile-shortcuts";
import {
  canChooseWhen,
  effectiveShortcut,
  type FocusArea,
  recordKind,
  type ShortcutScope,
  withWhen,
  type ShortcutCommandDefinition,
  type ShortcutShell,
} from "@/features/shortcuts/catalogue";

/** "assigned" lists commands with keys; "all" lists every command. Search always covers all. */
export type ShortcutFilter = "all" | "assigned";

/** One command as Settings shows it on this device. */
export type ShortcutCommandView = {
  entry: ShortcutCommandDefinition;
  label: string;
  /** Undefined until the preferences load. */
  current: ShortcutCombination | null | undefined;
  defaultKeys: ShortcutCombination | null;
  customized: boolean;
  /** The user may change when the command runs. */
  whenChoice: boolean;
  /** The `when` choice differs from the default. */
  whenCustomized: boolean;
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
const POSITION_PATTERN = /^(session|workspace)-position-(\d+)$/;

/** The row label of a position command, such as "Session 3", from its id. */
export const positionRowLabel = (id: ShortcutActionId): string | undefined => {
  const match = POSITION_PATTERN.exec(id);
  if (!match) return undefined;
  return `${match[1] === "session" ? "Session" : "Workspace"} ${match[2]}`;
};
const MAC_KEY_WORDS = new Map([
  ["⌘", ["cmd", "command"]],
  ["⌃", ["ctrl", "control"]],
  ["⌥", ["opt", "option", "alt"]],
  ["⇧", ["shift"]],
  ["↵", ["enter", "return"]],
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
  // One phrase per synonym, so "ctrl b" and "control b" both match the keys ⌃B.
  const phrases = [0, 1, 2].map((index) =>
    parts
      .map((part) => {
        const names = MAC_KEY_WORDS.get(part);
        return names ? names[Math.min(index, names.length - 1)] : part;
      })
      .join(" "),
  );
  return [parts.join(""), parts.join("+"), parts.join(" "), ...phrases].join(" | ");
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
  return { ...preferences, overrides };
};

/** A `when` choice equal to the default is removed, so the saved document lists only changes. */
export const withWhenChoice = (
  preferences: ShortcutPreferences,
  command: ShortcutCommandDefinition,
  when: ShortcutWhen,
): ShortcutPreferences => {
  const choices = { ...preferences.when };
  if (when === command.defaultWhen) delete choices[command.id];
  else choices[command.id] = when;
  return { ...preferences, when: choices };
};

/**
 * A `when` choice and the problem it would cause the command on this device. Only the command's
 * own new problem counts; a conflict elsewhere does not depend on the choice.
 */
export const whenChoiceChange = (
  preferences: ShortcutPreferences,
  catalogue: readonly ShortcutCommandDefinition[],
  command: ShortcutCommandDefinition,
  when: ShortcutWhen,
  device: { platform: AppPlatform; shell: ShortcutShell },
) => {
  const next = withWhenChoice(preferences, command, when);
  const problemIn = (candidate: ShortcutPreferences) =>
    compileShortcuts(candidate, catalogue, device.platform, device.shell).problems.get(command.id);
  const problem = problemIn(next);
  return { preferences: next, problem: problem && !problemIn(preferences) ? problem : null };
};

/** True when Reset all would change something. */
export const hasChanges = (preferences: ShortcutPreferences | undefined) =>
  Boolean(
    preferences &&
    (Object.keys(preferences.overrides).length > 0 ||
      Object.keys(preferences.when ?? {}).length > 0),
  );

export const buildCommandViews = (
  catalogue: readonly ShortcutCommandDefinition[],
  preferences: ShortcutPreferences | undefined,
  platform: AppPlatform,
  shell: ShortcutShell,
): ShortcutCommandView[] => {
  const compiled = preferences ? compileShortcuts(preferences, catalogue, platform, shell) : null;
  return catalogue.map((raw) => {
    const entry = preferences ? withWhen(raw, preferences) : raw;
    const current = preferences ? effectiveShortcut(entry, preferences, shell) : undefined;
    return {
      entry,
      label: entry.label.startsWith(`${entry.group}: `)
        ? entry.label.slice(entry.group.length + 2)
        : entry.label,
      current,
      defaultKeys: entry.defaultKeys[shell],
      customized: Boolean(preferences && Object.hasOwn(preferences.overrides, entry.id)),
      whenChoice: canChooseWhen(entry),
      whenCustomized: entry.when !== entry.defaultWhen,
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
  /** A command being edited or just removed; it stays listed so the edit or its Undo stays put. */
  kept: ShortcutActionId | null = null,
): Map<string, ShortcutGroupItem[]> => {
  const fold = term === "";
  const groups = new Map<string, ShortcutGroupItem[]>();
  for (const view of views) {
    const hidden =
      view.entry.id !== kept &&
      (term ? !view.search.includes(term) : filter === "assigned" && !view.current);
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

const FOCUS_WHEN = {
  panel: "A panel has focus",
  git: "The Git panel has focus",
  browser: "A browser tab has focus",
  content: "An item has focus",
} as const satisfies Record<FocusArea, string>;

/**
 * When a command runs, for Settings. App-wide commands say only whether they run while typing,
 * because typing is the most common reason that a key does nothing; a workspace or a session that
 * they need is obvious from their name.
 */
export const whenLabel = (scope: ShortcutScope, when: ShortcutWhen): string => {
  if (scope.kind === "focus") return FOCUS_WHEN[scope.area];
  const record = recordKind(scope);
  if (record) return record === "chat" ? "A session is selected" : "A task is selected";
  return when === "always" ? "Always" : "Not while typing";
};
