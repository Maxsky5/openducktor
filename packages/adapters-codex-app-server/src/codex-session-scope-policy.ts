import { type CodexEffectivePolicy, ODT_MCP_TOOL_NAMES } from "@openducktor/contracts";
import {
  AGENT_ROLE_TOOL_POLICY,
  type AgentSessionRuntimePolicy,
  type AgentSessionScope,
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

export const resolveCodexSessionScopePolicy = (
  sessionScope: AgentSessionScope | null | undefined,
  runtimePolicy: AgentSessionRuntimePolicy | undefined,
  action: string,
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
          enabledTools: [...AGENT_ROLE_TOOL_POLICY[sessionScope.role]],
        };
  return withAgentSessionTitle(policy, sessionScope);
};
