import type { ReusablePrompt } from "@openducktor/contracts";
import { REUSABLE_PROMPT_TRIGGER_PATTERN } from "@openducktor/contracts";

export type ReusablePromptValidationErrors = {
  name?: string;
  content?: string;
};

export type ReusablePromptValidationMap = Record<string, ReusablePromptValidationErrors>;

// Preserve blank draft rows and raw spacing so controlled multi-line inputs do not collapse
// trailing newlines or strip characters while the user is still editing. Save-time
// normalization removes blank commands and trims persisted values.
export const parseHookLines = (value: string): string[] => value.split("\n");

export const createReusablePromptDraft = (): ReusablePrompt => {
  if (globalThis.crypto === undefined || crypto.randomUUID === undefined) {
    throw new Error(
      "Cannot create a reusable prompt because random UUID generation is unavailable.",
    );
  }

  return {
    id: crypto.randomUUID(),
    name: "",
    description: "",
    content: "",
  };
};

const isValidReusablePromptName = (name: string): boolean =>
  REUSABLE_PROMPT_TRIGGER_PATTERN.test(name.trim());

export const buildReusablePromptValidationErrors = (prompts: ReusablePrompt[]) => {
  const errorsById: ReusablePromptValidationMap = {};
  const promptIdsByNormalizedName = new Map<string, string[]>();

  for (const prompt of prompts) {
    const name = prompt.name.trim();
    const content = prompt.content.trim();
    const errors: ReusablePromptValidationErrors = {};

    if (!name) {
      errors.name = "Prompt name is required.";
    } else if (!isValidReusablePromptName(name)) {
      errors.name = "Use only letters, digits, dots, underscores, colons, or dashes.";
    } else {
      const normalizedName = name.toLowerCase();
      promptIdsByNormalizedName.set(normalizedName, [
        ...(promptIdsByNormalizedName.get(normalizedName) ?? []),
        prompt.id,
      ]);
    }

    if (!content) {
      errors.content = "Prompt content is required.";
    }

    if (Object.keys(errors).length > 0) {
      errorsById[prompt.id] = errors;
    }
  }

  for (const promptIds of promptIdsByNormalizedName.values()) {
    if (promptIds.length < 2) {
      continue;
    }
    for (const promptId of promptIds) {
      errorsById[promptId] = {
        ...errorsById[promptId],
        name: "Prompt names must be unique.",
      };
    }
  }

  return errorsById satisfies ReusablePromptValidationMap;
};

export const countReusablePromptValidationErrors = (
  errorsById: ReusablePromptValidationMap,
): number =>
  Object.values(errorsById).reduce(
    (count, errors) => count + (errors.name ? 1 : 0) + (errors.content ? 1 : 0),
    0,
  );

export const prepareReusablePromptsForSave = (prompts: ReusablePrompt[]): ReusablePrompt[] => {
  const errors = buildReusablePromptValidationErrors(prompts);
  if (countReusablePromptValidationErrors(errors) > 0) {
    throw new Error("Reusable prompts contain invalid fields.");
  }

  return prompts.map((prompt) => ({
    id: prompt.id.trim(),
    name: prompt.name.trim(),
    description: prompt.description.trim(),
    content: prompt.content.trim(),
  }));
};

/** Trims each line and drops the blank lines. */
export const dropBlankLines = (lines: readonly string[]): string[] =>
  lines.flatMap((line) => {
    const trimmed = line.trim();
    return trimmed ? [trimmed] : [];
  });
