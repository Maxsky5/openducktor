import type { RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentSessionScope } from "@openducktor/core";
import { withAgentSessionTitle } from "@openducktor/core";
import {
  buildRepositoryScopedPermissionRules,
  buildRoleScopedPermissionRules,
  type OpencodePermissionRule,
} from "./workflow-tool-permissions";

export type OpencodeSessionPolicy = {
  /** Runtime session title. `undefined` keeps the current title. */
  title?: string;
  activityLabel: string;
  permission: OpencodePermissionRule[];
  toolSelection:
    | { kind: "workflow"; role: Extract<AgentSessionScope, { kind: "workflow" }>["role"] }
    | { kind: "repository" };
};

export const resolveOpencodeSessionPolicy = (
  sessionScope: AgentSessionScope | null | undefined,
  runtimeDescriptor: RuntimeDescriptor,
  action: string,
): OpencodeSessionPolicy => {
  if (!sessionScope) {
    throw new Error(`Cannot ${action} without session context.`);
  }
  const policy: OpencodeSessionPolicy =
    sessionScope.kind === "workflow"
      ? {
          activityLabel: sessionScope.role,
          permission: buildRoleScopedPermissionRules({
            role: sessionScope.role,
            runtimeDescriptor,
          }),
          toolSelection: { kind: "workflow", role: sessionScope.role },
        }
      : {
          activityLabel: "repository",
          permission: buildRepositoryScopedPermissionRules(runtimeDescriptor),
          toolSelection: { kind: "repository" },
        };
  return withAgentSessionTitle(policy, sessionScope);
};
