import type { WorkflowCondition, WorkflowDocumentDefinition } from "@openducktor/contracts";

export const CONDITION_KINDS = [
  "always",
  "never",
  "issueType",
  "stateIn",
  "present",
  "absent",
  "verdict",
  "all",
  "any",
  "not",
] as const;
export type ConditionKind = (typeof CONDITION_KINDS)[number];

export const CONDITION_KIND_LABELS = {
  always: "Always",
  never: "Never",
  issueType: "Issue type is",
  stateIn: "Task is in",
  present: "Document exists",
  absent: "Document is missing",
  verdict: "Review result is",
  all: "All of these",
  any: "Any of these",
  not: "Not this",
} satisfies Record<ConditionKind, string>;

/** The kind of a condition. A fact other than the issue type counts as an issue type test. */
export const conditionKind = (condition: WorkflowCondition): ConditionKind => {
  if (condition === true) return "always";
  if (condition === false) return "never";
  if ("fact" in condition) return "issueType";
  if ("stateIn" in condition) return "stateIn";
  if ("artifact" in condition) {
    if ("verdict" in condition) return "verdict";
    return condition.present ? "present" : "absent";
  }
  if ("all" in condition) return "all";
  if ("any" in condition) return "any";
  return "not";
};

/** The reviews that have a verdict, for verdict conditions. */
const reviews = (definition: WorkflowDocumentDefinition) =>
  definition.artifacts.flatMap((artifact) => (artifact.kind === "review" ? [artifact] : []));

/** Why the kind cannot apply yet, or undefined. The condition stays valid that way. */
export const conditionKindBlocker = (
  kind: ConditionKind,
  definition: WorkflowDocumentDefinition,
): string | undefined => {
  if (kind === "issueType" && definition.issueTypes.length === 0)
    return "Add a supported issue type first.";
  if ((kind === "present" || kind === "absent") && definition.artifacts.length === 0)
    return "Add an artifact first.";
  if (kind === "verdict" && reviews(definition).length === 0) return "Add a review artifact first.";
  return undefined;
};

/** The only part of a group or a negation, or undefined. */
const onlyPart = (condition: WorkflowCondition): WorkflowCondition | undefined => {
  if (condition === true || condition === false) return undefined;
  if ("all" in condition) return condition.all.length === 1 ? condition.all[0] : undefined;
  if ("any" in condition) return condition.any.length === 1 ? condition.any[0] : undefined;
  return "not" in condition ? condition.not : undefined;
};

/**
 * A new condition of a kind. It names the first declared element of each needed kind. A group or
 * a negation takes the previous condition as its first part, and the only part of a group or a
 * negation that has the new kind takes its place, so a kind change keeps the work.
 */
export const conditionOfKind = (
  kind: ConditionKind,
  previous: WorkflowCondition,
  definition: WorkflowDocumentDefinition,
): WorkflowCondition => {
  const part = onlyPart(previous);
  if (part !== undefined && conditionKind(part) === kind) return part;
  switch (kind) {
    case "always":
      return true;
    case "never":
      return false;
    case "issueType":
      return { fact: "issueType", equals: definition.issueTypes[0]?.id ?? "task" };
    case "stateIn":
      return { stateIn: [] };
    case "present":
    case "absent": {
      const artifact =
        previous !== true && previous !== false && "artifact" in previous
          ? previous.artifact
          : definition.artifacts[0]!.id;
      return { artifact, present: kind === "present" };
    }
    case "verdict": {
      const review = reviews(definition)[0]!;
      return { artifact: review.id, verdict: review.verdicts[0]!.id };
    }
    case "all":
      return { all: [previous] };
    case "any":
      return { any: [previous] };
    case "not":
      return { not: previous };
  }
};

/** "A", "A or B", "A, B, or C". */
const joined = (items: readonly string[], word: "and" | "or"): string =>
  items.length <= 2
    ? items.join(` ${word} `)
    : `${items.slice(0, -1).join(", ")}, ${word} ${items.at(-1)}`;

/**
 * A condition in one plain sentence, such as "the task is in Review and the QA Report result is
 * Rejected". A group inside another group goes in brackets, so the sentence keeps its meaning.
 */
export const conditionSentence = (
  condition: WorkflowCondition,
  definition: WorkflowDocumentDefinition,
  nested = false,
): string => {
  const state = (id: string) => definition.states.find((item) => item.id === id)?.label || id;
  const artifact = (id: string) => definition.artifacts.find((item) => item.id === id)?.label || id;
  if (condition === true) return "always";
  if (condition === false) return "never";
  if ("fact" in condition) {
    const type = definition.issueTypes.find(({ id }) => id === condition.equals);
    return `the issue type is ${type?.label || String(condition.equals)}`;
  }
  if ("stateIn" in condition)
    return condition.stateIn.length === 0
      ? "the task is in no state"
      : `the task is in ${joined(condition.stateIn.map(state), "or")}`;
  if ("artifact" in condition) {
    const name = artifact(condition.artifact);
    if (!("verdict" in condition))
      return condition.present ? `${name} exists` : `${name} is missing`;
    const review = definition.artifacts.find(({ id }) => id === condition.artifact);
    const verdict =
      review?.kind === "review"
        ? review.verdicts.find(({ id }) => id === condition.verdict)?.label
        : undefined;
    return `the ${name} result is ${verdict || condition.verdict}`;
  }
  if ("not" in condition) return negated(condition.not, definition);
  const all = "all" in condition;
  const parts = (all ? condition.all : condition.any).map((part) =>
    conditionSentence(part, definition, true),
  );
  if (parts.length === 0) return all ? "always" : "never";
  const sentence = joined(parts, all ? "and" : "or");
  return nested && parts.length > 1 ? `(${sentence})` : sentence;
};

/** "Not" of a condition: a single test reads with "not", and a group goes in brackets. */
const negated = (condition: WorkflowCondition, definition: WorkflowDocumentDefinition): string => {
  const sentence = conditionSentence(condition, definition);
  if (condition === true) return "never";
  if (condition === false) return "always";
  if ("artifact" in condition && !("verdict" in condition))
    return conditionSentence({ ...condition, present: !condition.present }, definition);
  if ("stateIn" in condition || "fact" in condition) return sentence.replace(" is ", " is not ");
  if ("verdict" in condition) return sentence.replace(/ result is /, " result is not ");
  return `not (${sentence})`;
};
