import type {
  WorkflowCondition,
  WorkflowFactDefinition,
  WorkflowProblemPath,
  WorkflowValue,
} from "@openducktor/contracts";
import type { RuleDefinition } from "./definition-rules";

/** Declared issue types make the `issueType` enum fact. */
export const declaredFacts = (definition: Pick<RuleDefinition, "facts" | "issueTypes">) =>
  definition.issueTypes.length === 0
    ? definition.facts
    : [
        ...definition.facts,
        {
          id: "issueType",
          type: "enum" as const,
          values: definition.issueTypes.map(({ id }) => id),
        },
      ];

export const factValueTest = (
  fact: WorkflowFactDefinition,
): ((value: WorkflowValue | undefined) => boolean) => {
  switch (fact.type) {
    case "boolean":
      return (value) => value === true || value === false;
    case "number":
      return (value) => Number.isFinite(value);
    case "string":
      // Only a primitive string equals its own String conversion.
      return (value) => String(value) === value;
    case "enum": {
      const values = new Set<WorkflowValue | undefined>(fact.values);
      return (value) => values.has(value);
    }
  }
};

export const factValueDescription = (fact: WorkflowFactDefinition): string =>
  fact.type === "enum"
    ? `one of ${fact.values.map((value) => JSON.stringify(value)).join(", ")}`
    : `a ${fact.type} value`;

export type ConditionCheck = (
  condition: WorkflowCondition,
  path: WorkflowProblemPath,
  owner: string,
) => void;

/** Reports each condition part that names an undeclared fact, artifact, verdict, or state. */
export const createConditionCheck = (
  definition: RuleDefinition,
  report: (path: WorkflowProblemPath, message: string) => void,
): ConditionCheck => {
  const facts = new Map(declaredFacts(definition).map((fact) => [fact.id, fact]));
  const artifacts = new Map(definition.artifacts.map((artifact) => [artifact.id, artifact]));
  const states = new Set(definition.states.map((state) => state.id));
  const check: ConditionCheck = (condition, path, owner) => {
    if (condition === true || condition === false) return;
    if ("fact" in condition) {
      const fact = facts.get(condition.fact);
      if (!fact) {
        report(
          [...path, "fact"],
          condition.fact === "issueType"
            ? `${owner} checks the issue type, but the workflow has no issue types. Add one.`
            : `${owner} checks the unknown value "${condition.fact}". Check the issue type instead.`,
        );
        return;
      }
      if (!factValueTest(fact)(condition.equals))
        report(
          [...path, "equals"],
          condition.fact === "issueType"
            ? `${owner} checks for the issue type ${JSON.stringify(condition.equals)}, which the workflow does not support. Use ${factValueDescription(fact)}.`
            : `${owner} checks "${condition.fact}" for ${JSON.stringify(condition.equals)}. Use ${factValueDescription(fact)}.`,
        );
    } else if ("artifact" in condition) {
      const artifact = artifacts.get(condition.artifact);
      if (!artifact) {
        report(
          [...path, "artifact"],
          `${owner} uses the missing artifact "${condition.artifact}". Add it or pick another artifact.`,
        );
        return;
      }
      if (!("verdict" in condition)) return;
      if (artifact.kind !== "review") {
        report(
          [...path, "artifact"],
          `${owner} checks a verdict of document "${artifact.label || artifact.id}", but only reviews have verdicts. Pick a review.`,
        );
        return;
      }
      if (!artifact.verdicts.some((verdict) => verdict.id === condition.verdict))
        report(
          [...path, "verdict"],
          `${owner} checks the verdict "${condition.verdict}", which review "${artifact.label || artifact.id}" does not have. Pick one of its verdicts.`,
        );
    } else if ("stateIn" in condition) {
      condition.stateIn.forEach((id, index) => {
        if (!states.has(id))
          report(
            [...path, "stateIn", index],
            `${owner} uses the missing state "${id}". Add it or pick another state.`,
          );
      });
    } else if ("not" in condition) {
      check(condition.not, [...path, "not"], owner);
    } else {
      const key = "all" in condition ? "all" : "any";
      const children = "all" in condition ? condition.all : condition.any;
      children.forEach((child, index) => check(child, [...path, key, index], owner));
    }
  };
  return check;
};
