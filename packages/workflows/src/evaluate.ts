import {
  workflowConditionSchema,
  workflowDefinitionSchema,
  type CompiledWorkflowDefinition,
  type WorkflowCondition,
  type WorkflowDecision,
  type WorkflowDefinition,
  type WorkflowFactDefinition,
  type WorkflowInput,
  type WorkflowStepProjection,
  type WorkflowValue,
} from "@openducktor/contracts";
import { deepFreeze } from "./deep-freeze";

export type WorkflowEvaluationErrorCode =
  | "invalid_definition"
  | "invalid_condition"
  | "invalid_input"
  | "unknown_state"
  | "missing_fact"
  | "unknown_action"
  | "unknown_event"
  | "missing_event_outcome";

export class WorkflowEvaluationError extends Error {
  constructor(
    readonly code: WorkflowEvaluationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorkflowEvaluationError";
  }
}

export type WorkflowPredicate = (input: WorkflowInput) => boolean;

export type Workflow = {
  readonly definition: CompiledWorkflowDefinition;
  steps(input: WorkflowInput): WorkflowStepProjection[];
  availableActions(input: WorkflowInput): string[];
  isActionAvailable(input: WorkflowInput, actionId: string): boolean;
  isEventAvailable(input: WorkflowInput, eventId: string): boolean;
  decide(input: WorkflowInput, eventId: string): WorkflowDecision;
  /** Checks an extra condition against this definition once and returns its predicate. */
  condition(condition: WorkflowCondition): WorkflowPredicate;
};

type Denial = { reason: "source_state" } | { reason: "guard"; guardId: string } | null;
type CompiledEvent = {
  from: ReadonlySet<string>;
  guards: readonly { id: string; test: WorkflowPredicate }[];
  outcomes: readonly { test: WorkflowPredicate; to: string | null }[];
};
type CompiledAction = { id: string; available: WorkflowPredicate; event: CompiledEvent | null };

/** Parses, checks, freezes, and compiles a private copy. Conditions and outcomes short-circuit in order. */
export const createWorkflow = (source: WorkflowDefinition): Workflow => {
  const definition = parseDefinition(source);
  const identity = { workflowId: definition.id, definitionRevision: definition.revision };
  const states = new Set(definition.states.map((state) => state.id));
  const terminalStates = new Set(
    definition.states.filter((state) => state.terminal).map((state) => state.id),
  );
  const facts = new Map(
    definition.facts.map((fact) => [fact.id, { fact, accepts: valueTest(fact) }] as const),
  );
  checkDefinition(definition);

  const events = new Map(
    definition.events.map((event): [string, CompiledEvent] => [
      event.id,
      {
        from: new Set(event.from),
        guards: event.guards.map((guard) => ({ id: guard.id, test: compile(guard.when) })),
        outcomes: event.outcomes.map((outcome) => ({
          test: compile(outcome.when),
          to: outcome.to,
        })),
      },
    ]),
  );
  const actions = definition.actions.map((action): CompiledAction => ({
    id: action.id,
    available: compile(action.availableWhen),
    event: action.kind === "event" ? eventById(action.eventId) : null,
  }));
  const actionsById = new Map(actions.map((action) => [action.id, action]));
  const steps = definition.steps.map((step) => ({
    step,
    required: compile(step.requiredWhen),
    available: compile(step.availableWhen),
    completed: compile(step.completedWhen),
  }));

  return {
    definition,
    steps(input) {
      checkInput(input);
      return steps.map(({ step, required, available, completed }): WorkflowStepProjection =>
        step.kind === "agent"
          ? {
              id: step.id,
              label: step.label,
              kind: "agent",
              roleId: step.roleId,
              inputs: step.inputs,
              outputs: step.outputs,
              required: required(input),
              available: available(input),
              completed: completed(input),
            }
          : {
              id: step.id,
              label: step.label,
              kind: "human",
              inputs: step.inputs,
              outputs: step.outputs,
              required: required(input),
              available: available(input),
              completed: completed(input),
            },
      );
    },
    availableActions(input) {
      checkInput(input);
      const available: string[] = [];
      for (const action of actions) {
        if (actionAvailable(input, action)) available.push(action.id);
      }
      return available;
    },
    isActionAvailable(input, actionId) {
      checkInput(input);
      const action = actionsById.get(actionId);
      if (!action) {
        throw new WorkflowEvaluationError(
          "unknown_action",
          `Workflow "${definition.id}" has no action "${actionId}". Use an ID from its actions.`,
        );
      }
      return actionAvailable(input, action);
    },
    isEventAvailable(input, eventId) {
      checkInput(input);
      return findDenial(input, eventById(eventId)) === null;
    },
    decide(input, eventId) {
      checkInput(input);
      const event = eventById(eventId);
      const denial = findDenial(input, event);
      if (denial !== null)
        return { ...identity, kind: "denied", eventId, state: input.state, ...denial };
      for (const outcome of event.outcomes) {
        if (!outcome.test(input)) continue;
        const to = outcome.to ?? input.state;
        if (to === input.state)
          return { ...identity, kind: "unchanged", eventId, state: input.state };
        if (terminalStates.has(input.state)) {
          return {
            ...identity,
            kind: "denied",
            eventId,
            state: input.state,
            reason: "terminal_state",
          };
        }
        return { ...identity, kind: "transition", eventId, from: input.state, to };
      }
      throw new WorkflowEvaluationError(
        "missing_event_outcome",
        `Workflow "${definition.id}" has no matching outcome for event "${eventId}" in state "${input.state}". Add a matching outcome or fix its conditions.`,
      );
    },
    condition(condition) {
      const parsed = workflowConditionSchema.safeParse(condition);
      if (!parsed.success) {
        throw new WorkflowEvaluationError(
          "invalid_condition",
          `Invalid condition for workflow "${definition.id}": ${firstIssueMessage(parsed.error.issues, "condition")}. Use a data-only workflow condition.`,
        );
      }
      createConditionCheck(definition, (message) => {
        throw new WorkflowEvaluationError(
          "invalid_condition",
          `Invalid condition for workflow "${definition.id}". ${message}`,
        );
      })(parsed.data, "condition");
      const test = compile(parsed.data);
      return (input) => {
        checkInput(input);
        return test(input);
      };
    },
  };

  function checkInput(input: WorkflowInput): void {
    if (input.workflowId !== definition.id || input.definitionRevision !== definition.revision) {
      throw new WorkflowEvaluationError(
        "invalid_input",
        `Input identifies workflow "${input.workflowId}" revision ${input.definitionRevision}. Use workflowId "${definition.id}" and definitionRevision ${definition.revision}.`,
      );
    }
    if (!states.has(input.state)) {
      throw new WorkflowEvaluationError(
        "unknown_state",
        `Workflow "${definition.id}" has no state "${input.state}". Use an ID from its states.`,
      );
    }
    const supplied = input.facts;
    for (const id in supplied) {
      const declared = facts.get(id);
      if (!declared) {
        throw new WorkflowEvaluationError(
          "invalid_input",
          `Workflow "${definition.id}" has no fact "${id}". Remove facts.${id} or declare the fact.`,
        );
      }
      if (!declared.accepts(supplied[id])) {
        throw new WorkflowEvaluationError(
          "invalid_input",
          `Invalid facts.${id} for workflow "${definition.id}". Supply ${valueDescription(declared.fact)}.`,
        );
      }
    }
  }

  function compile(condition: WorkflowCondition): WorkflowPredicate {
    if (condition === true) return () => true;
    if (condition === false) return () => false;
    if ("fact" in condition) {
      const { fact, equals } = condition;
      return (input) => {
        if (!Object.hasOwn(input.facts, fact)) {
          throw new WorkflowEvaluationError(
            "missing_fact",
            `Workflow "${definition.id}" needs fact "${fact}". Supply it in input.facts.`,
          );
        }
        return input.facts[fact] === equals;
      };
    }
    if ("stateIn" in condition) {
      const stateIn = new Set(condition.stateIn);
      return (input) => stateIn.has(input.state);
    }
    if ("not" in condition) {
      const test = compile(condition.not);
      return (input) => !test(input);
    }
    if ("all" in condition) {
      const tests = condition.all.map(compile);
      return (input) => {
        for (const test of tests) if (!test(input)) return false;
        return true;
      };
    }
    const tests = condition.any.map(compile);
    return (input) => {
      for (const test of tests) if (test(input)) return true;
      return false;
    };
  }

  function eventById(eventId: string): CompiledEvent {
    const event = events.get(eventId);
    if (!event) {
      throw new WorkflowEvaluationError(
        "unknown_event",
        `Workflow "${definition.id}" has no event "${eventId}". Use an ID from its events.`,
      );
    }
    return event;
  }

  function findDenial(input: WorkflowInput, event: CompiledEvent): Denial {
    if (!event.from.has(input.state)) return { reason: "source_state" };
    for (const guard of event.guards) {
      if (!guard.test(input)) return { reason: "guard", guardId: guard.id };
    }
    return null;
  }

  function actionAvailable(input: WorkflowInput, action: CompiledAction): boolean {
    return (
      (action.event === null || findDenial(input, action.event) === null) && action.available(input)
    );
  }
};

const parseDefinition = (source: WorkflowDefinition): WorkflowDefinition => {
  const parsed = workflowDefinitionSchema.safeParse(source);
  if (!parsed.success) {
    throw new WorkflowEvaluationError(
      "invalid_definition",
      `Invalid workflow definition at ${firstIssueMessage(parsed.error.issues, "definition")}. Fix the definition.`,
    );
  }
  return deepFreeze(parsed.data);
};

const firstIssueMessage = (
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
  root: string,
): string => {
  const issue = issues[0];
  return `${issue?.path.map(String).join(".") || root}: ${issue?.message}`;
};

type ConditionCheck = (condition: WorkflowCondition, path: string) => void;

const createConditionCheck = (
  definition: WorkflowDefinition,
  invalid: (message: string) => never,
): ConditionCheck => {
  const facts = new Map(definition.facts.map((fact) => [fact.id, fact]));
  const states = new Set(definition.states.map((state) => state.id));
  const check: ConditionCheck = (condition, path) => {
    if (condition === true || condition === false) return;
    if ("fact" in condition) {
      const fact = facts.get(condition.fact);
      if (!fact) {
        return invalid(`Unknown fact "${condition.fact}" at ${path}.fact. Declare it in facts.`);
      }
      if (!valueTest(fact)(condition.equals)) {
        invalid(
          `Invalid comparison at ${path}.equals for fact "${condition.fact}". Use ${valueDescription(fact)}.`,
        );
      }
    } else if ("stateIn" in condition) {
      condition.stateIn.forEach((id, index) => {
        if (!states.has(id)) {
          invalid(`Unknown states ID "${id}" at ${path}.stateIn[${index}]. Use an ID from states.`);
        }
      });
    } else if ("not" in condition) {
      check(condition.not, `${path}.not`);
    } else {
      const key = "all" in condition ? "all" : "any";
      const children = "all" in condition ? condition.all : condition.any;
      children.forEach((child, index) => check(child, `${path}.${key}[${index}]`));
    }
  };
  return check;
};

const checkDefinition = (definition: WorkflowDefinition): void => {
  const invalid = (message: string): never => {
    throw new WorkflowEvaluationError(
      "invalid_definition",
      `Workflow "${definition.id}" is invalid. ${message}`,
    );
  };
  const checkCondition = createConditionCheck(definition, invalid);
  const checkIds = (items: readonly { id: string }[], collection: string): Set<string> => {
    const result = new Set<string>();
    for (const item of items) {
      if (result.has(item.id))
        invalid(`Duplicate ID "${item.id}" in ${collection}. Use unique IDs.`);
      result.add(item.id);
    }
    return result;
  };
  const checkReference = (id: string, known: Set<string>, collection: string, path: string) => {
    if (!known.has(id))
      invalid(`Unknown ${collection} ID "${id}" at ${path}. Use an ID from ${collection}.`);
  };

  checkIds(definition.facts, "facts");
  const roles = checkIds(definition.roles, "roles");
  const artifacts = checkIds(definition.artifacts, "artifacts");
  const states = checkIds(definition.states, "states");
  const steps = checkIds(definition.steps, "steps");
  const events = checkIds(definition.events, "events");
  checkIds(definition.actions, "actions");

  checkReference(definition.initialState, states, "states", "initialState");
  definition.steps.forEach((step, index) => {
    const path = `steps[${index}]`;
    if (step.kind === "agent") checkReference(step.roleId, roles, "roles", `${path}.roleId`);
    step.inputs.forEach((id, artifactIndex) =>
      checkReference(id, artifacts, "artifacts", `${path}.inputs[${artifactIndex}]`),
    );
    step.outputs.forEach((id, artifactIndex) =>
      checkReference(id, artifacts, "artifacts", `${path}.outputs[${artifactIndex}]`),
    );
    checkCondition(step.requiredWhen, `${path}.requiredWhen`);
    checkCondition(step.availableWhen, `${path}.availableWhen`);
    checkCondition(step.completedWhen, `${path}.completedWhen`);
  });
  definition.actions.forEach((action, index) => {
    const path = `actions[${index}]`;
    if (action.stepId !== undefined)
      checkReference(action.stepId, steps, "steps", `${path}.stepId`);
    if (action.kind === "event")
      checkReference(action.eventId, events, "events", `${path}.eventId`);
    checkCondition(action.availableWhen, `${path}.availableWhen`);
  });
  definition.events.forEach((event, index) => {
    const path = `events[${index}]`;
    event.from.forEach((id, fromIndex) =>
      checkReference(id, states, "states", `${path}.from[${fromIndex}]`),
    );
    checkIds(event.guards, `${path}.guards`);
    event.guards.forEach((guard, guardIndex) =>
      checkCondition(guard.when, `${path}.guards[${guardIndex}].when`),
    );
    event.outcomes.forEach((outcome, outcomeIndex) => {
      const outcomePath = `${path}.outcomes[${outcomeIndex}]`;
      if (outcome.to !== null) checkReference(outcome.to, states, "states", `${outcomePath}.to`);
      checkCondition(outcome.when, `${outcomePath}.when`);
    });
  });
};

const valueTest = (
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

const valueDescription = (fact: WorkflowFactDefinition): string =>
  fact.type === "enum"
    ? `one of ${fact.values.map((value) => JSON.stringify(value)).join(", ")}`
    : `a ${fact.type} value`;
