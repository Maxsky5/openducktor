import { type CodexEffectivePolicy, ODT_MCP_TOOL_NAMES } from "@openducktor/contracts";
import {
  type AgentSessionRuntimePolicy,
  type AgentSessionScope,
  type WorkflowRolePolicyResolver,
  withAgentSessionTitle,
} from "@openducktor/core";
import { requireCodexRuntimePolicy } from "./codex-session-policy";

type CodexSessionScopePolicyBase = {
  /** Runtime session title. `undefined` keeps the current title. */
  title?: string;
  runtimePolicy: CodexEffectivePolicy;
  /** OpenDucktor MCP tools that the session scope allows. */
  enabledTools: string[];
};

export type CodexSessionScopePolicy =
  | (CodexSessionScopePolicyBase & {
      kind: "workflow";
      sessionScope: Extract<AgentSessionScope, { kind: "workflow" }>;
    })
  | (CodexSessionScopePolicyBase & {
      kind: "repository";
      sessionScope: Extract<AgentSessionScope, { kind: "repository" }>;
    });

/**
 * A workflow session enables the tools of the role policy that it keeps from its start.
 * `externalSessionId` is null while a start or fork has no thread yet.
 */
export const resolveCodexSessionScopePolicy = (
  {
    sessionScope,
    runtimePolicy,
  }: {
    sessionScope?: AgentSessionScope | null | undefined;
    runtimePolicy?: AgentSessionRuntimePolicy | undefined;
  },
  externalSessionId: string | null,
  action: string,
  resolveWorkflowRolePolicy: WorkflowRolePolicyResolver,
): CodexSessionScopePolicy => {
  if (!sessionScope) {
    throw new Error(`Cannot ${action} without session context.`);
  }
  const effectivePolicy = requireCodexRuntimePolicy(runtimePolicy, action);
  const policy: CodexSessionScopePolicy =
    sessionScope.kind === "repository"
      ? {
          kind: "repository",
          sessionScope,
          runtimePolicy: effectivePolicy,
          enabledTools: [...ODT_MCP_TOOL_NAMES],
        }
      : {
          kind: "workflow",
          sessionScope,
          runtimePolicy: effectivePolicy,
          enabledTools: [
            ...resolveWorkflowRolePolicy({ ...sessionScope, externalSessionId }).tools,
          ],
        };
  return withAgentSessionTitle(policy, sessionScope);
};
