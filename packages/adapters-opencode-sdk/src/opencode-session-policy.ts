import type { RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentSessionScope, WorkflowRolePolicyResolver } from "@openducktor/core";
import { withAgentSessionTitle } from "@openducktor/core";
import {
  buildRepositoryScopedPermissionRules,
  buildRoleScopedPermissionRules,
  type OpencodePermissionRule,
} from "./workflow-tool-permissions";

export type OpencodeSessionPolicy = {
  /** Runtime session title. `undefined` keeps the current title. */
  title?: string;
  permission: OpencodePermissionRule[];
  scope:
    | { kind: "workflow"; role: Extract<AgentSessionScope, { kind: "workflow" }>["role"] }
    | { kind: "repository" };
};

/** A workflow session gets the permissions of its role in the task workflow of its task. */
export const resolveOpencodeSessionPolicy = (
  { sessionScope }: { sessionScope?: AgentSessionScope | null | undefined },
  runtimeDescriptor: RuntimeDescriptor,
  action: string,
  resolveWorkflowRolePolicy: WorkflowRolePolicyResolver,
): OpencodeSessionPolicy => {
  if (!sessionScope) {
    throw new Error(`Cannot ${action} without session context.`);
  }
  const policy: OpencodeSessionPolicy =
    sessionScope.kind === "workflow"
      ? {
          permission: buildRoleScopedPermissionRules({
            rolePolicy: resolveWorkflowRolePolicy(sessionScope),
            runtimeDescriptor,
          }),
          scope: { kind: "workflow", role: sessionScope.role },
        }
      : {
          permission: buildRepositoryScopedPermissionRules(runtimeDescriptor),
          scope: { kind: "repository" },
        };
  return withAgentSessionTitle(policy, sessionScope);
};
