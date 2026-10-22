import type { ClaudePolicyFields } from "@openducktor/contracts";
import type { Options, Query } from "@anthropic-ai/claude-agent-sdk";
import { type AgentSessionScope, withAgentSessionTitle } from "@openducktor/core";
import { Effect } from "effect";
import { HostOperationError, HostValidationError } from "../../effect/host-errors";
import { INIT_TIMEOUT_MS, toClaudeServiceError, withTimeout } from "./claude-agent-sdk-utils";
import { loadClaudeTodos } from "./claude-agent-sdk-todos";
import type {
  ClaudeSessionInput,
  CreateClaudeAgentSdkServiceInput,
} from "./claude-agent-sdk-types";
import type { ClaudeTranscriptReadOwner } from "./claude-transcript-read-owner";

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
  claudePolicy?: ClaudePolicyFields | null;
  externalSessionId: string;
  options: Pick<Options, "forkSession" | "resume" | "sessionId">;
  parentExternalSessionId?: string;
  forkSourceWorkingDirectory?: string;
  /**
   * Adds CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1 so the bundled CLI classifies the
   * transcript tail and starts its hidden continuation turn.
   */
  resumeInterruptedTurn?: boolean;
  preserveNativeSettings?: boolean;
  /**
   * Reconciles the durable session title with the runtime. A failed update must not
   * fail the attach, because the next attach can retry it.
   */
  reconcileTitle?: boolean;
  startedMessage: string;
  title?: string;
};

export const loadClaudeSessionLaunchState = (
  input: ClaudeSessionInput,
  launch: ClaudeSessionLaunchInput,
  policy: CreateClaudeAgentSdkServiceInput["launchPolicy"],
  reader: ClaudeTranscriptReadOwner,
) =>
  Effect.gen(function* () {
    const isNew =
      !launch.options.resume ||
      launch.options.forkSession === true ||
      launch.forkSourceWorkingDirectory !== undefined;
    const claudePolicy = isNew
      ? yield* policy.resolve({
          role: input.sessionScope.kind === "workflow" ? input.sessionScope.role : null,
        })
      : null;
    const initialTodos = launch.options.resume
      ? yield* loadClaudeTodos(
          {
            ...input,
            workingDirectory: launch.forkSourceWorkingDirectory ?? input.workingDirectory,
            externalSessionId: launch.options.resume,
          },
          { reader },
        ).pipe(
          Effect.mapError((cause) => toClaudeServiceError("claudeRuntime.loadSessionTodos", cause)),
        )
      : [];
    return { claudePolicy, initialTodos };
  });

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
    ? {
        ...withAgentSessionTitle({ startedMessage: "Resumed session" }, scope),
        reconcileTitle: true,
      }
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

export const forkedClaudeReplySessionLaunch = (
  scope: AgentSessionScope,
  externalSessionId: string,
  forkSourceWorkingDirectory: string,
): ClaudeSessionLaunchInput => ({
  externalSessionId,
  forkSourceWorkingDirectory,
  ...sessionPresentation("Forked", scope),
  options: { resume: externalSessionId },
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

const sessionPresentation = (
  action: "Continued" | "Forked" | "Resumed" | "Started",
  scope: AgentSessionScope,
) =>
  withAgentSessionTitle(
    {
      startedMessage: `${action} ${scope.kind === "repository" ? "repository" : scope.role} session`,
    },
    scope,
  );
