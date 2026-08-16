import { type CodexEffectivePolicy, ODT_MCP_TOOL_NAMES } from "@openducktor/contracts";
import {
  AGENT_ROLE_TOOL_POLICY,
  type AgentSessionRuntimePolicy,
  type AgentSessionScope,
  formatAgentSessionTitle,
} from "@openducktor/core";
import { requireCodexRuntimePolicy } from "./codex-session-policy";

type CodexSessionThreadConfig = {
  "mcp_servers.openducktor.enabled": true;
  "mcp_servers.openducktor.enabled_tools": string[];
};

type CodexSessionScopePolicyBase = {
  title: string;
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
  const policy = requireCodexRuntimePolicy(runtimePolicy, action);
  if (sessionScope.kind === "repository") {
    return {
      kind: "repository",
      sessionScope,
      title: formatAgentSessionTitle(sessionScope),
      runtimePolicy: policy,
      threadConfig: buildThreadConfig(ODT_MCP_TOOL_NAMES),
    };
  }
  return {
    kind: "workflow",
    sessionScope,
    title: formatAgentSessionTitle(sessionScope),
    runtimePolicy: policy,
    threadConfig: buildThreadConfig(AGENT_ROLE_TOOL_POLICY[sessionScope.role]),
  };
};
