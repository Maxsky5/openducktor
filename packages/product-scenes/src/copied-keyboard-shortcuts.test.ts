import { describe, expect, test } from "bun:test";
import { type ComponentType, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type KeyLabels, type KeyPlatform, MAC_KEYS, PC_KEYS } from "./replicas/keys";
import { heldText, recordingHint, ROW_TEXT } from "./replicas/settings/ShortcutRow";
import { SEARCH_PLACEHOLDER, SHORTCUT_TEXT } from "./replicas/settings/ShortcutSettings";
import { navPositions, positionHint } from "./replicas/shell/nav";
import { HINT_DELAY } from "./replicas/shell/position-hints";
import {
  GROUPS,
  JUMP_DIGIT,
  RECORDED,
  SEARCH,
  SEARCH_STEPS,
  START_NAV,
  STEP_KEYS,
  THIRD,
} from "./scenes/keyboard-shortcuts/sample";
import { importProduct, readProduct, readProductWords } from "./test-support/product-source";

type AppPlatform = "darwin" | "win32";
type Combination = {
  key: { kind: "logical"; key: string } | { kind: "number-row"; digit: string };
  mod: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
};
type Command = {
  id: string;
  group: string;
  scope: { kind: string };
  when: string;
  defaultKeys: Record<"electron" | "browser", Combination | null>;
};
type View = {
  entry: Command;
  label: string;
  current: Combination | null | undefined;
  whenChoice: boolean;
};
type GroupItem = { kind: "command"; command: View } | { kind: "family" };
type Preferences = { version: 1; overrides: Record<string, Combination | null> };
type Modifiers = { ctrl: boolean; meta: boolean; alt: boolean; shift: boolean };
type ShortcutInput = Modifiers & {
  phase: "down";
  key: string;
  code: string;
  composing: boolean;
  repeat: boolean;
  altGraph: boolean;
};
/** The compiled bindings of one device. The test reads them only through the app. */
type Compiled = { problems: ReadonlyMap<string, { message: string }> };
type RowEditor = { state: "recording"; preparing: boolean; held: readonly string[]; ignored: null };
/** The props of SettingsShortcutRow that the test gives. Its actions never run. */
type RowProps = {
  entry: Command;
  label: string;
  platform: AppPlatform;
  current: Combination | null;
  inactiveReason: undefined;
  defaultKeys: null;
  customized: boolean;
  whenChoice: boolean;
  whenCustomized: boolean;
  disabled: boolean;
  editor: RowEditor | null;
  note: readonly string[];
  actions: Record<"record" | "assign" | "chooseWhen" | "cancel" | "replace", () => void>;
};

const SETTINGS = "packages/frontend/src/components/features/settings";
const SHORTCUTS = "packages/frontend/src/features/shortcuts";

// SAFETY: catalogue.ts exports these values, and a missing export fails the test.
const catalogue = await importProduct<{
  SHORTCUT_COMMANDS: readonly Command[];
  commandDefinition: (id: string) => Command | undefined;
  workflowCommandDefinition: (id: string, workflowId: string, label: string) => Command;
}>(`${SHORTCUTS}/catalogue.ts`);
// SAFETY: settings-shortcut-model.ts exports these functions, and a missing export fails the test.
const model = await importProduct<{
  buildCommandViews: (
    catalogue: readonly Command[],
    preferences: Preferences,
    platform: AppPlatform,
    shell: "electron",
  ) => View[];
  groupCommandViews: (
    views: readonly View[],
    filter: "all",
    term: string,
  ) => Map<string, GroupItem[]>;
  searchKey: (value: string) => string;
  whenLabel: (scope: Command["scope"], when: string) => string;
}>(`${SETTINGS}/settings-shortcut-model.ts`);
// SAFETY: compile-shortcuts.ts exports these functions, and a missing export fails the test.
const compiler = await importProduct<{
  compileShortcuts: (
    preferences: Preferences,
    catalogue: readonly Command[],
    platform: AppPlatform,
    shell: "electron" | "browser",
  ) => Compiled;
  problemOfCommand: (
    compiled: Compiled,
    catalogue: readonly Command[],
    id: string,
  ) => { message: string } | null;
  otherDeviceProblems: (
    preferences: Preferences,
    catalogue: readonly Command[],
    id: string,
    device: { platform: AppPlatform; shell: "electron" },
  ) => string[];
}>(`${SHORTCUTS}/compile-shortcuts.ts`);
// SAFETY: key-labels.ts exports these functions, and a missing export fails the test.
const labels = await importProduct<{
  shortcutKeyParts: (combination: Combination, platform: AppPlatform) => string[];
  modifierKeyParts: (modifiers: Modifiers, platform: AppPlatform) => string[];
  spokenShortcut: (combination: Combination, platform: AppPlatform) => string;
}>("packages/frontend-core/src/shortcuts/key-labels.ts");
// SAFETY: the contracts export these values, and a missing export fails the test.
const contracts = await importProduct<{
  recordShortcut: (input: ShortcutInput, platform: AppPlatform) => Combination | null;
  workflowShortcutActionId: (workflowId: string, actionId: string) => string;
}>("packages/contracts/src/index.ts");
// SAFETY: workflow-fixtures.ts exports the compiled built-in catalog.
const { builtinCompiledCatalogFixture } = await importProduct<{
  builtinCompiledCatalogFixture: {
    workflows: Map<
      string,
      { definition: { id: string; actions: readonly { id: string; label?: string }[] } }
    >;
  };
}>("packages/frontend-core/src/test-support/workflow-fixtures.ts");
// SAFETY: settings-shortcut-row.tsx exports the row, and a missing export fails the test.
const { SettingsShortcutRow } = await importProduct<{
  SettingsShortcutRow: ComponentType<RowProps>;
}>(`${SETTINGS}/settings-shortcut-row.tsx`);

/** The commands of Settings, as useShortcutCatalogue of use-shortcut-catalogue.ts lists them. */
const commands: readonly Command[] = [
  ...catalogue.SHORTCUT_COMMANDS,
  ...[...builtinCompiledCatalogFixture.workflows.values()].flatMap(({ definition }) =>
    definition.actions.map((action) =>
      catalogue.workflowCommandDefinition(
        contracts.workflowShortcutActionId(definition.id, action.id),
        definition.id,
        action.label ?? action.id,
      ),
    ),
  ),
];
const NO_CHANGE: Preferences = { version: 1, overrides: {} };

const PLATFORMS = [
  { platform: "mac", app: "darwin", keys: MAC_KEYS },
  { platform: "pc", app: "win32", keys: PC_KEYS },
] as const satisfies readonly { platform: KeyPlatform; app: AppPlatform; keys: KeyLabels }[];

/** The default keys of the command `id` as key caps. */
function defaultCaps(id: string, app: AppPlatform): string[] {
  const keys = catalogue.commandDefinition(id)?.defaultKeys.electron;
  if (!keys) throw new Error(`The app has no default keys for ${id}.`);
  return labels.shortcutKeyParts(keys, app);
}

/** The modifiers of Mod alone, and of Mod with Shift, on a platform. */
function modKeys(app: AppPlatform, shift: boolean): Modifiers {
  return { ctrl: app !== "darwin", meta: app === "darwin", alt: false, shift };
}

/** The keys that the recorder takes when the visitor presses Mod Shift F. */
function recordModShiftF(app: AppPlatform): Combination {
  const input: ShortcutInput = {
    ...modKeys(app, true),
    phase: "down",
    key: "F",
    code: "KeyF",
    composing: false,
    repeat: false,
    altGraph: false,
  };
  const combination = contracts.recordShortcut(input, app);
  if (!combination) throw new Error("The recorder takes no keys for Mod Shift F.");
  return combination;
}

const NO_ACTION = (): void => {};

/** The text that a row shows, without the words for screen readers. */
function visibleText(markup: string): string {
  return markup
    .replace(/<span class="sr-only">[^<]*<\/span>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("the keyboard shortcuts copied from the app", () => {
  test("each search keeps the rows of the app, from the top, in its order", () => {
    for (const { app } of PLATFORMS) {
      const views = model.buildCommandViews(commands, NO_CHANGE, app, "electron");
      for (const step of SEARCH_STEPS) {
        const kept = [...model.groupCommandViews(views, "all", model.searchKey(step.term))]
          .flatMap(([, items]) => items)
          .map((item) => (item.kind === "command" ? item.command.entry.id : "family"));
        expect(kept.slice(0, step.commands.length)).toEqual([...step.commands]);
        if (step.term === SEARCH) expect(kept).toEqual([...step.commands]);
      }
    }
  });

  test("the view lists the rows of each search in the order of the app", () => {
    const listed = GROUPS.flatMap(({ commands: rows }) => rows.map((row) => row.id));
    for (const step of SEARCH_STEPS)
      expect(listed.filter((id) => step.commands.includes(id))).toEqual([...step.commands]);
  });

  test("each row has the group, the label, the When line, and the keys of the app", () => {
    for (const { platform, app } of PLATFORMS) {
      const views = model.buildCommandViews(commands, NO_CHANGE, app, "electron");
      for (const { group, commands: rows } of GROUPS)
        for (const row of rows) {
          const view = views.find((candidate) => candidate.entry.id === row.id);
          if (!view) throw new Error(`The app has no command ${row.id}.`);
          expect({
            group: view.entry.group,
            label: view.label,
            when: model.whenLabel(view.entry.scope, view.entry.when),
            picker: view.whenChoice,
            keys: view.current ? labels.shortcutKeyParts(view.current, app) : null,
          }).toEqual({
            group,
            label: row.label,
            when: row.when,
            picker: row.picker,
            keys: row.keys ? [...row.keys[platform]] : null,
          });
        }
    }
  });

  test("Mod shows the position hints of the default keys, and Mod 3 opens session 3", () => {
    for (const { platform, app, keys } of PLATFORMS) {
      const mod = STEP_KEYS[platform].mod;
      expect(labels.modifierKeyParts(modKeys(app, false), app)).toEqual([mod]);
      expect(defaultCaps("session-position-3", app)).toEqual([mod, JUMP_DIGIT]);
      const jump = catalogue.commandDefinition("session-position-3")?.defaultKeys.electron;
      if (!jump) throw new Error("The app has no default keys for session 3.");
      expect(labels.spokenShortcut(jump, app)).toBe(
        `${STEP_KEYS[platform].words.mod} ${JUMP_DIGIT}`,
      );
      const [shift] = labels.modifierKeyParts(
        { ...modKeys(app, true), ctrl: false, meta: false },
        app,
      );
      if (!shift) throw new Error("The app has no key cap for Shift.");
      for (const position of [1, 2, 3, 4]) {
        const session = defaultCaps(`session-position-${position}`, app);
        expect(session.at(-1)).toBe(positionHint("session", position, keys));
        const workspace = defaultCaps(`workspace-position-${position}`, app);
        expect(workspace).toContain(shift);
        expect(`${shift} ${workspace.at(-1)}`).toBe(positionHint("workspace", position, keys));
      }
    }
    expect(navPositions(START_NAV).get(THIRD.entry.id)).toBe(Number(JUMP_DIGIT));
  });

  test("the hints show at once after the delay of position-hints.css", async () => {
    const css = await readProduct(`${SHORTCUTS}/position-hints.css`);
    const delays = [...css.matchAll(/transition-delay:\s*(\d+)ms/g)].map(([, ms]) => Number(ms));
    expect(delays.length).toBeGreaterThan(0);
    expect(new Set(delays)).toEqual(new Set([HINT_DELAY * 1000]));
    expect(css.replace(/\s+/g, " ")).toContain("transition: visibility 0s;");
    const hint = await readProductWords([`${SHORTCUTS}/position-hint.tsx`]);
    expect(hint).toContain('const shift = platform === "darwin" ? "⇧" : "Shift";');
    expect(hint).toContain('hint = family === "workspace" ? `${shift} ${digit}` : digit;');
  });

  test("Settings opens with the default keys of Open Settings", () => {
    for (const { platform, app } of PLATFORMS)
      expect(defaultCaps("settings", app)).toEqual([...STEP_KEYS[platform].settings]);
  });

  test("Mod Shift F records with no problem and no note on any device", () => {
    for (const { platform, app } of PLATFORMS) {
      const steps = STEP_KEYS[platform];
      expect([
        labels.modifierKeyParts(modKeys(app, false), app),
        labels.modifierKeyParts(modKeys(app, true), app),
      ]).toEqual(steps.recording.map((keys) => [...keys]));
      const combination = recordModShiftF(app);
      expect(labels.shortcutKeyParts(combination, app)).toEqual([...steps.recorded]);
      expect(labels.spokenShortcut(combination, app)).toBe(steps.words.recorded);
      expect([...RECORDED.keys[platform]]).toEqual([...steps.recorded]);
      const preferences: Preferences = { version: 1, overrides: { [RECORDED.id]: combination } };
      for (const shell of ["electron", "browser"] as const) {
        const compiled = compiler.compileShortcuts(preferences, commands, app, shell);
        expect(compiler.problemOfCommand(compiled, commands, RECORDED.id)).toBeNull();
      }
      expect(
        compiler.otherDeviceProblems(preferences, commands, RECORDED.id, {
          platform: app,
          shell: "electron",
        }),
      ).toEqual([]);
    }
  });

  test("the row and its recorder show the words of the app", () => {
    const entry = catalogue.commandDefinition(RECORDED.id);
    const row = GROUPS.flatMap(({ commands: rows }) => rows).find(({ id }) => id === RECORDED.id);
    if (!entry || !row) throw new Error(`The scene and the app need ${RECORDED.id}.`);
    for (const { platform, app } of PLATFORMS) {
      const render = (props: Partial<RowProps>): string =>
        visibleText(
          renderToStaticMarkup(
            createElement(SettingsShortcutRow, {
              entry,
              label: row.label,
              platform: app,
              current: null,
              inactiveReason: undefined,
              defaultKeys: null,
              customized: false,
              whenChoice: false,
              whenCustomized: false,
              disabled: false,
              editor: null,
              note: [],
              actions: {
                record: NO_ACTION,
                assign: NO_ACTION,
                chooseWhen: NO_ACTION,
                cancel: NO_ACTION,
                replace: NO_ACTION,
              },
              ...props,
            }),
          ),
        );
      const recording = (held: readonly string[]): Partial<RowProps> => ({
        editor: { state: "recording", preparing: false, held, ignored: null },
      });
      const steps = STEP_KEYS[platform];
      expect(render({})).toBe(`${row.label} ${ROW_TEXT.when} ${row.when} ${ROW_TEXT.addKeys}`);
      expect(render(recording([]))).toBe(
        `${row.label} ${recordingHint(platform)} ${ROW_TEXT.pressKeys} ${ROW_TEXT.cancel} ${ROW_TEXT.escape}`,
      );
      for (const held of steps.recording) expect(render(recording(held))).toContain(heldText(held));
      const combination = recordModShiftF(app);
      expect(render({ current: combination, customized: true })).toBe(
        `${row.label} ${ROW_TEXT.custom} ${ROW_TEXT.when} ${row.when} ${ROW_TEXT.remove} ${steps.recorded.join(" ")}`,
      );
    }
  });

  test("the section has the words of the app", async () => {
    const section = await readProductWords([`${SETTINGS}/settings-keyboard-shortcuts-section.tsx`]);
    for (const text of [SHORTCUT_TEXT.title, SHORTCUT_TEXT.description, SHORTCUT_TEXT.resetAll])
      expect(section).toContain(text);
    for (const label of SHORTCUT_TEXT.filters) expect(section).toContain(`label: "${label}"`);
    const lead = "Search commands or keys, such as ";
    expect(section).toContain(
      `placeholder={\`${lead}\${platform === "darwin" ? "⌘K" : "Ctrl+K"}\`}`,
    );
    expect(SEARCH_PLACEHOLDER).toEqual({ mac: `${lead}⌘K`, pc: `${lead}Ctrl+K` });
  });
});
