import type { AgentPromptAppend, AgentPromptOverride } from "@openducktor/contracts";
import type { SettingsPromptTemplate } from "@openducktor/frontend-core/queries/workflow-prompt-settings";
import {
  appendAddsText,
  isPromptOverrideOn,
  isPromptOverrideOutdated,
  promptBase,
  promptScopeLayerProblems,
  type PromptLayerProblems,
  type PromptSettings,
  type PromptSettingsLayers,
} from "@openducktor/workflows";

/** The placeholder problem of each layer of one prompt, in the scope of one screen. */
export type PromptValidationErrors = Partial<Record<string, PromptLayerProblems>>;

/** The state of a prompt on its screen. */
export type PromptStatus = {
  /** An append of this screen adds text. */
  appended: boolean;
  /** An override of this screen is on. */
  overridden: boolean;
  /** The override of this screen was reviewed against an older built-in version. */
  outdated: boolean;
  /** A layer of this screen has a placeholder problem. */
  error: boolean;
  /** Repository prompts only: the System prompts change this prompt. */
  globalChanges: boolean;
};

/** The badge of each state. */
export const PROMPT_STATUS_LABELS = {
  appended: "Appended",
  overridden: "Overridden",
  outdated: "Outdated",
  error: "Error",
  globalChanges: "Global changes",
} satisfies Record<keyof PromptStatus, string>;

/** The order of the badges. */
const BADGE_ORDER: readonly (keyof PromptStatus)[] = [
  "appended",
  "overridden",
  "outdated",
  "error",
  "globalChanges",
];

/** The states of a prompt that show a badge, in badge order. */
export const promptStatusMarks = (status: PromptStatus): (keyof PromptStatus)[] =>
  BADGE_ORDER.filter((key) => status[key]);

/** The layers of this screen change the prompt. Changes of the global settings do not count. */
export const isPromptChanged = (status: PromptStatus): boolean =>
  status.appended || status.overridden;

/** A change to the prompt layers that a screen edits. */
export type PromptSettingsLayersUpdater = (current: PromptSettingsLayers) => PromptSettingsLayers;

/**
 * The layers that a prompt screen edits. System prompts edit the global layers. Repository
 * prompts edit the layers of one repository, on top of the global layers.
 */
export type PromptScope =
  | { kind: "global"; edited: PromptSettingsLayers }
  | { kind: "repository"; edited: PromptSettingsLayers; inherited: PromptSettingsLayers };

/** The layers that a prompt of the screen gets, in the order of a prompt build. */
export const promptSettingsOfScope = (scope: PromptScope): PromptSettings =>
  scope.kind === "global"
    ? { global: scope.edited }
    : { global: scope.inherited, repository: scope.edited };

/** The placeholder problems of the layers that are on, for each prompt of one scope. */
export const buildPromptLayerValidationErrors = (
  layers: PromptSettingsLayers,
  templates: readonly SettingsPromptTemplate[],
) =>
  Object.fromEntries(
    templates.flatMap((template) => {
      const problems = promptScopeLayerProblems(layers, template.key, {
        requiredPlaceholders: template.requiredPlaceholders ?? [],
        fillablePlaceholders: template.placeholders,
      });
      return problems.override || problems.append ? [[template.key, problems] as const] : [];
    }),
  ) satisfies PromptValidationErrors;

/** The state of a prompt on its screen. */
export const promptStatus = (
  template: SettingsPromptTemplate,
  scope: PromptScope,
  errors: PromptLayerProblems | undefined,
): PromptStatus => {
  const { key } = template;
  const override = scope.edited.overrides[key];
  return {
    appended: appendAddsText(scope.edited.appends[key]),
    overridden: isPromptOverrideOn(override),
    outdated: isPromptOverrideOutdated(override, template.builtinVersion),
    error: errors !== undefined,
    globalChanges:
      scope.kind === "repository" &&
      (isPromptOverrideOn(scope.inherited.overrides[key]) ||
        appendAddsText(scope.inherited.appends[key])),
  };
};

const withoutKey = <Value>(record: Record<string, Value>, key: string): Record<string, Value> =>
  Object.fromEntries(Object.entries(record).filter(([entry]) => entry !== key));

/**
 * Typing in an empty append turns it on. Typing in an append with text keeps its state. Clearing
 * the text removes the append, so an empty append is never saved.
 */
export const setPromptAppendText = (
  layers: PromptSettingsLayers,
  key: string,
  text: string,
): PromptSettingsLayers => {
  if (text === "") return removePromptAppend(layers, key);
  const existing = layers.appends[key];
  const enabled = existing?.text.trim() ? existing.enabled : true;
  return { ...layers, appends: { ...layers.appends, [key]: { text, enabled } } };
};

/** Changes fields of an existing append. */
export const patchPromptAppend = (
  layers: PromptSettingsLayers,
  key: string,
  patch: Partial<AgentPromptAppend>,
): PromptSettingsLayers => {
  const existing = layers.appends[key];
  if (!existing) return layers;
  return { ...layers, appends: { ...layers.appends, [key]: { ...existing, ...patch } } };
};

export const removePromptAppend = (
  layers: PromptSettingsLayers,
  key: string,
): PromptSettingsLayers => ({ ...layers, appends: withoutKey(layers.appends, key) });

/**
 * Turns on the override of a prompt. A new override starts from the inherited text and is
 * reviewed against the current built-in version.
 */
export const replacePrompt = (
  layers: PromptSettingsLayers,
  key: string,
  inheritedText: string,
  builtinVersion: number,
): PromptSettingsLayers => {
  const existing = layers.overrides[key];
  return {
    ...layers,
    overrides: {
      ...layers.overrides,
      [key]: {
        template: existing?.template ?? inheritedText,
        baseVersion: existing?.baseVersion ?? builtinVersion,
        enabled: true,
      },
    },
  };
};

/**
 * Changes fields of an existing override, such as its text, its state, or the built-in version
 * that the user reviewed it against. Text never creates an override.
 */
export const patchPromptOverride = (
  layers: PromptSettingsLayers,
  key: string,
  patch: Partial<AgentPromptOverride>,
): PromptSettingsLayers => {
  const existing = layers.overrides[key];
  if (!existing) return layers;
  return { ...layers, overrides: { ...layers.overrides, [key]: { ...existing, ...patch } } };
};

export const removePromptOverride = (
  layers: PromptSettingsLayers,
  key: string,
): PromptSettingsLayers => ({ ...layers, overrides: withoutKey(layers.overrides, key) });

/**
 * The text that a new override starts from: the global override when it is on, else the built-in
 * text. On System prompts, an existing global override keeps its own text.
 */
export const inheritedPromptText = (template: SettingsPromptTemplate, scope: PromptScope): string =>
  promptBase({ global: promptSettingsOfScope(scope).global }, template.key).override?.template ??
  template.template;
