import {
  ODT_BROWSER_TOOL_NAMES,
  type AgentRoleDefinition,
  type AgentToolName,
} from "@openducktor/contracts";
import { deepFreeze } from "../../deep-freeze";
import { recordBy } from "../../record-by";
import { BUILTIN_ROLE_IDS, type BuiltinRoleId } from "./ids";
import { ROLE_SYSTEM_PROMPT_METADATA } from "./prompt-metadata";
import { ROLE_SYSTEM_PROMPTS } from "./prompt-templates";

const taskTools = [
  "odt_read_task",
  "odt_read_task_assets",
  "odt_read_task_artifacts",
  "odt_set_task_artifact",
  "odt_delete_task_artifact",
  "odt_search_tasks",
  "odt_create_task",
  "odt_update_task",
] as const satisfies readonly AgentToolName[];

const systemPrompt = (role: BuiltinRoleId) => ({
  ...ROLE_SYSTEM_PROMPTS[role],
  ...ROLE_SYSTEM_PROMPT_METADATA[role],
});

export type BuiltinAgentRole = AgentRoleDefinition & { id: BuiltinRoleId; tools: AgentToolName[] };

/** The built-in agent roles. Any workflow can bind them by ID. */
export const BUILTIN_ROLES: readonly BuiltinAgentRole[] = deepFreeze([
  {
    id: "spec",
    label: "Spec",
    tools: [...taskTools, ...ODT_BROWSER_TOOL_NAMES],
    workspaceAccess: "read",
    location: "repository",
    runtimeScopes: ["workspace"],
    systemPrompt: systemPrompt("spec"),
    icon: "specification",
  },
  {
    id: "planner",
    label: "Planner",
    tools: [...taskTools, ...ODT_BROWSER_TOOL_NAMES],
    workspaceAccess: "read",
    location: "repository",
    runtimeScopes: ["workspace"],
    systemPrompt: systemPrompt("planner"),
    icon: "planning",
  },
  {
    id: "build",
    label: "Builder",
    tools: [
      ...taskTools,
      "odt_apply_workflow_event",
      "odt_set_pull_request",
      ...ODT_BROWSER_TOOL_NAMES,
    ],
    workspaceAccess: "write",
    location: "task_worktree",
    runtimeScopes: ["build", "workspace"],
    systemPrompt: systemPrompt("build"),
    icon: "building",
    defaultPanel: "diffs",
  },
  {
    id: "qa",
    label: "QA",
    tools: [...taskTools, ...ODT_BROWSER_TOOL_NAMES],
    workspaceAccess: "read",
    location: "task_worktree",
    runtimeScopes: ["task"],
    systemPrompt: systemPrompt("qa"),
    icon: "quality",
  },
] satisfies BuiltinAgentRole[]);

const roleById = new Map(BUILTIN_ROLES.map((role) => [role.id, role]));
export const builtinRole = (id: BuiltinRoleId): BuiltinAgentRole => {
  const role = roleById.get(id);
  if (!role) throw new Error(`The built-in role catalog has no role ${id}.`);
  return role;
};
/** Builds a value for each built-in role. */
export const byRole = <Value>(
  read: (role: BuiltinAgentRole) => Value,
): Readonly<Record<BuiltinRoleId, Value>> =>
  deepFreeze(recordBy(BUILTIN_ROLE_IDS, (id) => read(builtinRole(id))));
