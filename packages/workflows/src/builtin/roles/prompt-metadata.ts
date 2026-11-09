import type { BuiltinRoleId } from "./ids";

/** The settings labels and descriptions of the built-in role system prompts. */
export const ROLE_SYSTEM_PROMPT_METADATA = {
  spec: {
    label: "Spec Instructions",
    description:
      "Resolves product decisions with the user and defines scope, required behavior, and constraints.",
  },
  planner: {
    label: "Planner Instructions",
    description:
      "Defines architecture, module responsibilities, interfaces, and contracts. Leaves implementation order and verification to Builder.",
  },
  build: {
    label: "Builder Instructions",
    description:
      "Completes the approved outcomes and design contracts with control over implementation, work order, and verification.",
  },
  qa: {
    label: "QA Instructions",
    description:
      "Reviews required outcomes, design contracts, correctness, and maintainability with checks based on risk.",
  },
} satisfies Record<BuiltinRoleId, { label: string; description: string }>;
