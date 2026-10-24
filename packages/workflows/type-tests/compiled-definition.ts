import type { WorkflowDefinition } from "@openducktor/contracts";
import { createWorkflow } from "../src";

declare const source: WorkflowDefinition;

source.label = "Updated label";
source.states.push({ id: "another-state", label: "Another state" });
source.steps[0]!.inputs.push("another-artifact");
source.events[0]!.guards.push({ id: "closed", when: false });

const definition = createWorkflow(source).definition;

// @ts-expect-error Compiled properties are readonly.
definition.label = "Changed";
// @ts-expect-error Nested compiled properties are readonly.
definition.states[0]!.label = "Changed";
// @ts-expect-error Compiled collections are readonly.
definition.states.push({ id: "another-state", label: "Another state" });
// @ts-expect-error Nested compiled collections are readonly.
definition.steps[0]!.inputs.push("another-artifact");
// @ts-expect-error Compiled event outcomes are readonly.
definition.events[0]!.outcomes[0]!.to = null;

// @ts-expect-error Compiled event guards are readonly.
definition.events[0]!.guards.push({ id: "closed", when: false });

const guard = definition.events[0]!.guards[0]!.when;
if (guard !== true && guard !== false && "all" in guard) {
  // @ts-expect-error Recursive condition collections are readonly.
  guard.all.push(true);
  const child = guard.all[0];
  if (child !== undefined && child !== true && child !== false && "fact" in child) {
    // @ts-expect-error Recursive condition properties are readonly.
    child.equals = false;
  }
}

const fact = definition.facts[0]!;
if (fact.type === "enum") {
  // @ts-expect-error Compiled enum values are readonly.
  fact.values.push(null);
}
