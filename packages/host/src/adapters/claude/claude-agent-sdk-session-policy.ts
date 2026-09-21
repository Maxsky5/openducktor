import type { Options, Query } from "@anthropic-ai/claude-agent-sdk";
import { type AgentSessionScope, formatAgentSessionTitle } from "@openducktor/core";
import { Effect } from "effect";
import { HostOperationError, HostValidationError } from "../../effect/host-errors";
import { INIT_TIMEOUT_MS, withTimeout } from "./claude-agent-sdk-utils";

export const requireClaudeSessionScope = (
  scope: AgentSessionScope | undefined,
  action: string,
): Effect.Effect<AgentSessionScope, HostValidationError> =>
  scope
    ? Effect.succeed(scope)
    : Effect.fail(
        new HostValidationError({
          field: "sessionScope",
          message: `Cannot ${action} without Claude session context.`,
        }),
      );

export type ClaudeSessionLaunchInput = {
  externalSessionId: string;
  options: Pick<Options, "forkSession" | "resume" | "sessionId">;
  parentExternalSessionId?: string;
  /**
   * Adds CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1 so the bundled CLI classifies the
   * transcript tail and starts its hidden continuation turn.
   */
  resumeInterruptedTurn?: boolean;
  preserveNativeSettings?: boolean;
  startedMessage: string;
  title?: string;
};

type ClaudeSessionPresentation = {
  startedMessage: string;
  title?: string;
};

const sessionPresentation = (
  action: "Continued" | "Forked" | "Resumed" | "Started",
  scope: AgentSessionScope,
): ClaudeSessionPresentation => {
  const presentation: ClaudeSessionPresentation = {
    startedMessage: `${action} ${scope.kind === "repository" ? "repository" : scope.role} session`,
  };
  const title = formatAgentSessionTitle(scope);
  if (title !== undefined) {
    presentation.title = title;
  }
  return presentation;
};

export const freshClaudeSessionLaunch = (
  scope: AgentSessionScope,
  externalSessionId: string,
): ClaudeSessionLaunchInput => ({
  externalSessionId,
  ...sessionPresentation("Started", scope),
  options: { sessionId: externalSessionId },
});

export const resumedClaudeSessionLaunch = (
  scope: AgentSessionScope,
  externalSessionId: string,
): ClaudeSessionLaunchInput => ({
  externalSessionId,
  ...(scope.kind === "repository"
    ? { startedMessage: "Resumed session" }
    : sessionPresentation("Resumed", scope)),
  options: { resume: externalSessionId },
});

/**
 * Relaunches a stored Claude session with the interrupted-turn resume switch.
 * The working directory, role, model, system prompt, and session identity stay unchanged.
 */
export const continuedClaudeSessionLaunch = (
  scope: AgentSessionScope,
  externalSessionId: string,
): ClaudeSessionLaunchInput => ({
  externalSessionId,
  ...sessionPresentation("Continued", scope),
  options: { resume: externalSessionId },
  resumeInterruptedTurn: true,
});

export const forkedClaudeSessionLaunch = (
  scope: AgentSessionScope,
  externalSessionId: string,
  parentExternalSessionId: string,
): ClaudeSessionLaunchInput => ({
  externalSessionId,
  parentExternalSessionId,
  ...sessionPresentation("Forked", scope),
  options: { resume: parentExternalSessionId, forkSession: true, sessionId: externalSessionId },
});

export const requireClaudeOpenDucktorMcpForScope = async (
  scope: AgentSessionScope,
  query: Pick<Query, "mcpServerStatus">,
  input: { externalSessionId: string; runtimeId: string },
): Promise<void> => {
  if (scope.kind !== "repository") {
    return;
  }
  const statuses = await withTimeout(
    query.mcpServerStatus(),
    INIT_TIMEOUT_MS,
    `Timed out while checking the OpenDucktor MCP server for Claude session '${input.externalSessionId}'.`,
  );
  const status = statuses.find((entry) => entry.name === "openducktor");
  if (status?.status === "connected") {
    return;
  }
  const statusDescription = status
    ? `${status.status}${status.error ? ` (${status.error})` : ""}`
    : "missing";
  throw new HostOperationError({
    operation: "claudeRuntime.requireOpenDucktorMcp",
    message: `OpenDucktor MCP server is not connected for repository Claude session '${input.externalSessionId}': ${statusDescription}.`,
    details: {
      externalSessionId: input.externalSessionId,
      runtimeId: input.runtimeId,
      mcpServer: "openducktor",
      status: status?.status ?? "missing",
    },
  });
};
