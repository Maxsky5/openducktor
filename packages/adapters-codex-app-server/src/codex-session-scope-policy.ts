import { type CodexEffectivePolicy, ODT_MCP_TOOL_NAMES } from "@openducktor/contracts";
import {
  AGENT_ROLE_TOOL_POLICY,
  type AgentSessionRuntimePolicy,
  type AgentSessionScope,
  withAgentSessionTitle,
} from "@openducktor/core";
import { requireCodexRuntimePolicy } from "./codex-session-policy";

type CodexSessionThreadConfig = {
  "mcp_servers.openducktor.enabled": true;
  "mcp_servers.openducktor.enabled_tools": string[];
};

type CodexSessionScopePolicyBase = {
  /** Runtime session title. `undefined` leaves the native thread name unchanged. */
  title?: string;
  runtimePolicy: CodexEffectivePolicy;
  threadConfig: CodexSessionThreadConfig;
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

const buildThreadConfig = (enabledTools: readonly string[]): CodexSessionThreadConfig => ({
  "mcp_servers.openducktor.enabled": true,
  "mcp_servers.openducktor.enabled_tools": [...enabledTools],
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
          threadConfig: buildThreadConfig(ODT_MCP_TOOL_NAMES),
        }
      : {
          kind: "workflow",
          sessionScope,
          runtimePolicy: effectivePolicy,
          threadConfig: buildThreadConfig(AGENT_ROLE_TOOL_POLICY[sessionScope.role]),
        };
  return withAgentSessionTitle(policy, sessionScope);
};
