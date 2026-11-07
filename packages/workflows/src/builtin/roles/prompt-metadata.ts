import type { BuiltinRoleId } from "./ids";

/** The settings labels and descriptions of the built-in role system prompts. */
export const ROLE_SYSTEM_PROMPT_METADATA = {
  spec: {
    label: "Spec Role Base",
    description:
      "Resolves product decisions with the user and defines scope, required behavior, and constraints.",
  },
  planner: {
    label: "Planner Role Base",
    description:
      "Defines architecture, module responsibilities, interfaces, and contracts. Leaves implementation order and verification to Builder.",
  },
  build: {
    label: "Builder Role Base",
    description:
      "Completes the approved outcomes and design contracts with control over implementation, work order, and verification.",
  },
  qa: {
    label: "QA Role Base",
    description:
      "Reviews required outcomes, design contracts, correctness, and maintainability with checks based on risk.",
  },
} satisfies Record<BuiltinRoleId, { label: string; description: string }>;
