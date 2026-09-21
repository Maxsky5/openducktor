import type { RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentSessionScope } from "@openducktor/core";
import { formatAgentSessionTitle } from "@openducktor/core";
import {
  buildRepositoryScopedPermissionRules,
  buildRoleScopedPermissionRules,
  type OpencodePermissionRule,
} from "./workflow-tool-permissions";

export type OpencodeSessionPolicy = {
  /** Runtime session name. `undefined` leaves the native session name unchanged. */
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
  if (sessionScope.kind === "workflow") {
    const policy: OpencodeSessionPolicy = {
      activityLabel: sessionScope.role,
      permission: buildRoleScopedPermissionRules({
        role: sessionScope.role,
        runtimeDescriptor,
      }),
      toolSelection: { kind: "workflow", role: sessionScope.role },
    };
    const title = formatAgentSessionTitle(sessionScope);
    return title === undefined ? policy : { ...policy, title };
  }
  const policy: OpencodeSessionPolicy = {
    activityLabel: "repository",
    permission: buildRepositoryScopedPermissionRules(runtimeDescriptor),
    toolSelection: { kind: "repository" },
  };
  const title = formatAgentSessionTitle(sessionScope);
  return title === undefined ? policy : { ...policy, title };
};
