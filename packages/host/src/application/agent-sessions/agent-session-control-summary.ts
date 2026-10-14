import {
  type AgentSessionControlSummary,
  type AgentSessionAuthorizedRoot,
  agentSessionControlSummarySchema,
} from "@openducktor/contracts";
import type { AgentSessionSummary } from "@openducktor/core";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";

export const toStartedSessionRoot = (
  input: Pick<AgentSessionAuthorizedRoot, "repoPath" | "sessionScope">,
  summary: Pick<
    AgentSessionControlSummary,
    "runtimeKind" | "workingDirectory" | "externalSessionId"
  >,
): AgentSessionAuthorizedRoot => ({
  repoPath: input.repoPath,
  sessionScope: input.sessionScope,
  runtimeKind: summary.runtimeKind,
  workingDirectory: summary.workingDirectory,
  externalSessionId: summary.externalSessionId,
});

export const toAgentSessionControlSummary = (
  summary: AgentSessionSummary,
  operation: string,
): Effect.Effect<AgentSessionControlSummary, HostValidationError<{ operation: string }>> =>
  Effect.try({
    try: () => {
      const control: AgentSessionControlSummary = {
        externalSessionId: summary.externalSessionId,
        runtimeKind: summary.runtimeKind,
        workingDirectory: summary.workingDirectory,
        startedAt: summary.startedAt,
        status: summary.status,
      };
      if (summary.title !== undefined) {
        control.title = summary.title;
      }
      if (summary.firstTurnCompleted !== undefined) {
        control.firstTurnCompleted = summary.firstTurnCompleted;
      }
      return agentSessionControlSummarySchema.parse(control);
    },
    catch: (cause) =>
      new HostValidationError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
        details: { operation },
      }),
  });
