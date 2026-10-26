import type { WorkflowLaunchRequest } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { connectionOf } from "../../connection/client-connection";
import { errorMessage } from "../../lib/errors";
import type { AgentSessionsStore } from "../agent-sessions-store";
import { projectWorkflowLaunch } from "../agent-orchestrator/session-read-model/workflow-launch-projection";
import {
  observeStartupPreparation,
  releaseStartupPreparationAttempt,
} from "../startup/startup-prepared-handoff";
import type { SessionStartWorkflowResult } from "./session-start-workflow";
import { WorkflowLaunchFailure } from "./session-start-workflow";

/** Keeps preparation repair and a known unsent instruction bound to the saved task session. */
export function installWorkflowStartupRecovery({
  queryClient,
  sessions,
  id,
  request,
  retryInstruction,
}: {
  queryClient: QueryClient;
  sessions: AgentSessionsStore;
  id: string;
  request: WorkflowLaunchRequest;
  retryInstruction?: SessionStartWorkflowResult["retryPostStartMessage"];
}): void {
  const {
    startupAttempts: attempts,
    host: { client: host },
  } = connectionOf(queryClient);
  const attempt = attempts.getAttempt(id);
  if (
    attempt?.ownership.state !== "saved" ||
    attempt.status.phase !== "failed" ||
    attempt.status.confirmation !== "current"
  )
    return;
  if (attempt.prepared) {
    if (!retryInstruction) return;
    attempts.setRecoveryActions(id, [
      {
        kind: "retry_message",
        label: "Retry message",
        run: async () => {
          const current = attempts.getAttempt(id);
          if (
            !current ||
            current.status.phase !== "failed" ||
            current.status.confirmation !== "current"
          )
            return;
          let receipt;
          try {
            receipt = await retryInstruction();
          } catch (cause) {
            attempts.fail(id, errorMessage(cause));
            return;
          }
          if (receipt && receipt.outcome !== "uncertain") {
            attempts.setInstruction(
              id,
              receipt.outcome === "queued"
                ? { state: "queued" }
                : {
                    state: "accepted",
                    ...(receipt.outcome === "acknowledged" && {
                      submissionId: receipt.submissionId,
                    }),
                  },
            );
            attempts.setRecoveryActions(id, []);
            if (receipt.outcome !== "queued" && receipt.postAcceptanceFailure)
              attempts.setWarning(id, receipt.postAcceptanceFailure);
            await attempts.complete(id);
          } else if (receipt?.outcome === "uncertain") {
            attempts.setRecoveryActions(id, []);
            attempts.fail(
              id,
              "Message delivery is unconfirmed. Inspect the session before sending again.",
              false,
            );
          }
        },
      },
    ]);
    return;
  }
  attempts.setRecoveryActions(id, [
    {
      kind: "repair",
      label: "Retry session preparation",
      run: async () => {
        const current = attempts.getAttempt(id);
        if (
          current?.ownership.state !== "saved" ||
          current.ownership.target.kind !== "task" ||
          current.status.phase !== "failed" ||
          current.status.confirmation !== "current"
        )
          return;
        const record = current.ownership.target.record;
        releaseStartupPreparationAttempt(queryClient, id);
        try {
          await observeStartupPreparation(queryClient, request.repoPath, id);
          const outcome = await attempts.operation(id, (startup) =>
            host.agentSessionWorkflowLaunch({
              workspaceId: request.workspaceId,
              repoPath: request.repoPath,
              taskId: request.taskId,
              startup,
              policy: {
                kind: "manual",
                actionId: request.policy.actionId,
                decision: {
                  startMode: "reuse",
                  sourceSession: {
                    runtimeKind: record.runtimeKind,
                    externalSessionId: record.externalSessionId,
                    workingDirectory: record.workingDirectory,
                  },
                },
              },
              instruction: { kind: "none" },
            }),
          );
          try {
            projectWorkflowLaunch(sessions, queryClient, outcome);
          } catch (cause) {
            console.error("Cannot show the repaired workflow session.", cause);
          }
          if (outcome.status !== "completed") throw new WorkflowLaunchFailure(outcome);
          if (!outcome.startupProgress?.prepared)
            throw new Error("Session preparation is unconfirmed. Inspect the saved session.");
          await attempts.complete(id);
          if (attempts.getAttempt(id)?.status.confirmation !== "current") return;
          if (
            current.instructionRequired &&
            (!current.instruction || !["accepted", "queued"].includes(current.instruction.state))
          ) {
            if (retryInstruction) {
              attempts.fail(
                id,
                "The session is prepared. The first instruction has not been sent.",
              );
              installWorkflowStartupRecovery({
                queryClient,
                sessions,
                id,
                request,
                retryInstruction,
              });
            } else
              attempts.fail(
                id,
                "Message delivery is unconfirmed. Inspect the session before sending again.",
                false,
              );
          }
        } catch (cause) {
          const latest = attempts.getAttempt(id);
          if (latest && !["failed", "canceled"].includes(latest.status.phase))
            attempts.fail(id, errorMessage(cause), false);
          installWorkflowStartupRecovery({ queryClient, sessions, id, request, retryInstruction });
        }
      },
    },
  ]);
}
