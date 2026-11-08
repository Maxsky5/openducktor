import type { Diagram } from "./spec";

/**
 * The loader of each diagram of the guides. A page loads only the spec module of its diagrams, so
 * it defines no other diagram. `tests/diagrams.test.ts` loads every diagram, so a diagram that
 * `defineDiagram` refuses fails the tests.
 */
export const DIAGRAMS = {
  approval: async () => (await import("./specs/git")).approval,
  autopilotRule: async () => (await import("./specs/workflow")).autopilotRule,
  gitlabSignIn: async () => (await import("./specs/git")).gitlabSignIn,
  host: async () => (await import("./specs/host")).host,
  kickoffPrompts: async () => (await import("./specs/prompts")).kickoffPrompts,
  laneMoves: async () => (await import("./specs/workflow")).laneMoves,
  microsoftSignIn: async () => (await import("./specs/git")).microsoftSignIn,
  modelChoice: async () => (await import("./specs/sessions")).modelChoice,
  permissionOrder: async () => (await import("./specs/sessions")).permissionOrder,
  promptSources: async () => (await import("./specs/prompts")).promptSources,
  pullRequest: async () => (await import("./specs/git")).pullRequest,
  remoteAccess: async () => (await import("./specs/host")).remoteAccess,
  specPlanBuildAutopilot: async () => (await import("./specs/workflow")).specPlanBuildAutopilot,
  systemPrompt: async () => (await import("./specs/prompts")).systemPrompt,
  taskFlow: async () => (await import("./specs/workflow")).taskFlow,
  workflow: async () => (await import("./specs/workflow")).workflow,
  worktree: async () => (await import("./specs/git")).worktree,
} satisfies Record<string, () => Promise<Diagram>>;

export type DiagramName = keyof typeof DIAGRAMS;

export const isDiagramName = (name: string): name is DiagramName => Object.hasOwn(DIAGRAMS, name);

const loads = new Map<DiagramName, Promise<Diagram>>();

/**
 * Loads a diagram once. A load that fails leaves no promise, so the next render loads it again.
 */
export function loadDiagram(name: DiagramName): Promise<Diagram> {
  const known = loads.get(name);
  if (known) return known;
  const load = DIAGRAMS[name]();
  loads.set(name, load);
  load.catch(() => loads.delete(name));
  return load;
}
