// The prompt layers that the user saves in Settings, and how they give the final text of a prompt.
import {
  validatePromptTemplatePlaceholders,
  type AgentPromptAppend,
  type AgentPromptOverride,
  type AgentPromptPlaceholder,
  type RepoPromptAppends,
  type RepoPromptOverrides,
} from "@openducktor/contracts";

/** The saved prompt layers of one settings scope. */
export type PromptSettingsLayers = {
  overrides: RepoPromptOverrides;
  appends: RepoPromptAppends;
};

/** The saved prompt layers that a prompt build reads: global, then the repository on top. */
export type PromptSettings = {
  global: PromptSettingsLayers;
  repository?: PromptSettingsLayers | undefined;
};

/** The prompt settings without a saved layer. Every prompt uses its built-in text. */
export const EMPTY_PROMPT_SETTINGS: PromptSettings = { global: { overrides: {}, appends: {} } };

/** The global prompt layers of the saved global settings. */
export const globalPromptLayersOf = (settings: {
  globalPromptOverrides: RepoPromptOverrides;
  globalPromptAppends: RepoPromptAppends;
}): PromptSettingsLayers => ({
  overrides: settings.globalPromptOverrides,
  appends: settings.globalPromptAppends,
});

/** The prompt layers of a saved repository configuration. */
export const repoPromptLayersOf = (config: {
  promptOverrides: RepoPromptOverrides;
  promptAppends: RepoPromptAppends;
}): PromptSettingsLayers => ({ overrides: config.promptOverrides, appends: config.promptAppends });

/** The global settings with new global prompt layers. */
export const withGlobalPromptLayers = <Settings extends Parameters<typeof globalPromptLayersOf>[0]>(
  settings: Settings,
  layers: PromptSettingsLayers,
): Settings => ({
  ...settings,
  globalPromptOverrides: layers.overrides,
  globalPromptAppends: layers.appends,
});

/** A repository configuration with new prompt layers. */
export const withRepoPromptLayers = <Config extends Parameters<typeof repoPromptLayersOf>[0]>(
  config: Config,
  layers: PromptSettingsLayers,
): Config => ({ ...config, promptOverrides: layers.overrides, promptAppends: layers.appends });

/** The prompt settings of the saved global settings and, for a repository, its configuration. */
export const promptSettingsOf = (
  global: Parameters<typeof globalPromptLayersOf>[0],
  repository?: Parameters<typeof repoPromptLayersOf>[0],
): PromptSettings => ({
  global: globalPromptLayersOf(global),
  repository: repository && repoPromptLayersOf(repository),
});

export type PromptLayerSource =
  | "builtin"
  | "global_override"
  | "repository_override"
  | "global_append"
  | "repository_append";

export type PromptLayerPart = { source: PromptLayerSource; text: string };

/** The label of each layer, as Settings shows it on the final text. */
export const PROMPT_LAYER_LABELS = {
  builtin: "Built-in",
  global_override: "Override · all repositories",
  repository_override: "Override · this repository",
  global_append: "Append · all repositories",
  repository_append: "Append · this repository",
} satisfies Record<PromptLayerSource, string>;

/** An override without `enabled` is on. Earlier versions saved overrides without the field. */
export const isPromptOverrideOn = (
  override: AgentPromptOverride | undefined,
): override is AgentPromptOverride => override !== undefined && override.enabled !== false;

/** The final text of one prompt, in layer parts, with the override that gives its base. */
type ComposedPrompt = {
  parts: PromptLayerPart[];
  override: AgentPromptOverride | undefined;
};

/** The layer that gives the base text of a prompt: the override that wins, or the built-in text. */
type PromptBase = { source: PromptLayerSource; override: AgentPromptOverride | undefined };

export const promptBase = (settings: PromptSettings, key: string): PromptBase => {
  const repositoryOverride = settings.repository?.overrides[key];
  if (isPromptOverrideOn(repositoryOverride))
    return { source: "repository_override", override: repositoryOverride };
  const globalOverride = settings.global.overrides[key];
  if (isPromptOverrideOn(globalOverride))
    return { source: "global_override", override: globalOverride };
  return { source: "builtin", override: undefined };
};

/**
 * The parts of the final text of one prompt, in layer order. The base is the repository override
 * when it is on, else the global override when it is on, else the built-in text. The global
 * append and then the repository append follow. An append that is off or blank adds nothing.
 * Placeholders stay unfilled.
 */
export const composePromptLayers = (
  builtin: string,
  settings: PromptSettings,
  key: string,
): ComposedPrompt => {
  const { source, override } = promptBase(settings, key);
  const parts: PromptLayerPart[] = [{ source, text: (override?.template ?? builtin).trim() }];
  const appends = [
    ["global_append", settings.global.appends[key]],
    ["repository_append", settings.repository?.appends[key]],
  ] as const;
  for (const [appendSource, append] of appends)
    if (append && appendAddsText(append))
      parts.push({ source: appendSource, text: append.text.trim() });
  return { parts, override };
};

/** The final text of one prompt from its parts. An empty override adds no blank lines. */
export const joinPromptLayers = (parts: readonly PromptLayerPart[]): string =>
  parts
    .map(({ text }) => text)
    .filter(Boolean)
    .join("\n\n");

/** Placeholders as a reader types them, for example `{{task.id}}, {{role}}`. */
const formatPromptPlaceholders = (placeholders: readonly string[]): string =>
  placeholders.map((placeholder) => `{{${placeholder}}}`).join(", ");

const plural = (count: number): string => (count > 1 ? "s" : "");

/** What a prompt can fill and what its base text must keep. */
export type PromptPlaceholderRules = {
  requiredPlaceholders: readonly string[];
  fillablePlaceholders: readonly AgentPromptPlaceholder[];
};

/**
 * Every placeholder problem of one layer text, as one message, or undefined. Only a base layer,
 * the built-in text or an override, has required placeholders. The message does not list the
 * placeholders that the prompt can fill: Settings shows them as buttons, and the host adds them
 * with `fillablePlaceholdersHint`.
 */
export const placeholderProblem = (
  text: string,
  requiredPlaceholders: readonly string[],
  fillablePlaceholders: readonly AgentPromptPlaceholder[],
): string | undefined => {
  const { unsupportedPlaceholders, unfillablePlaceholders, missingRequiredPlaceholders } =
    validatePromptTemplatePlaceholders(text, requiredPlaceholders, fillablePlaceholders);
  const messages: string[] = [];
  if (unsupportedPlaceholders.length > 0)
    messages.push(
      `Unsupported placeholder${plural(unsupportedPlaceholders.length)}: ${formatPromptPlaceholders(unsupportedPlaceholders)}.`,
    );
  if (unfillablePlaceholders.length > 0)
    messages.push(`This prompt cannot fill ${formatPromptPlaceholders(unfillablePlaceholders)}.`);
  if (missingRequiredPlaceholders.length > 0)
    messages.push(
      `Missing required placeholder${plural(missingRequiredPlaceholders.length)}: ${formatPromptPlaceholders(missingRequiredPlaceholders)}.`,
    );
  return messages.length > 0 ? messages.join(" ") : undefined;
};

/** The sentence that names the placeholders that a prompt can fill. */
export const fillablePlaceholdersHint = (
  fillablePlaceholders: readonly AgentPromptPlaceholder[],
): string => `This prompt can fill: ${formatPromptPlaceholders(fillablePlaceholders)}.`;

/** An override that is on and was reviewed against an older built-in version. */
export const isPromptOverrideOutdated = (
  override: AgentPromptOverride | undefined,
  builtinVersion: number,
): boolean => isPromptOverrideOn(override) && override.baseVersion !== builtinVersion;

/** An append that adds text to the final prompt: it is on and not blank. */
export const appendAddsText = (append: AgentPromptAppend | undefined): boolean =>
  Boolean(append?.enabled && append.text.trim());

/** The placeholder problem of each layer of one prompt that is on in one scope. */
export type PromptLayerProblems = { override?: string; append?: string };

/**
 * The placeholder problems of the override and the append of one prompt in one scope. A layer
 * that is off is not checked. Settings shows each problem below the editor of its layer.
 */
export const promptScopeLayerProblems = (
  layers: PromptSettingsLayers,
  key: string,
  rules: PromptPlaceholderRules,
): PromptLayerProblems => {
  const override = layers.overrides[key];
  const append = layers.appends[key];
  const problems: PromptLayerProblems = {};
  const overrideProblem = isPromptOverrideOn(override)
    ? placeholderProblem(override.template, rules.requiredPlaceholders, rules.fillablePlaceholders)
    : undefined;
  const appendProblem = append?.enabled
    ? placeholderProblem(append.text, [], rules.fillablePlaceholders)
    : undefined;
  if (overrideProblem) problems.override = overrideProblem;
  if (appendProblem) problems.append = appendProblem;
  return problems;
};
