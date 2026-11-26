import type { StartupInstruction, WorkflowLaunchRequest } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { connectionOf } from "../../connection/client-connection";
import { errorMessage } from "../../lib/errors";
import type { AgentSessionsStore } from "../agent-sessions-store";
import { projectWorkflowLaunch } from "../agent-orchestrator/session-read-model/workflow-launch-projection";
import {
  observeStartupPreparation,
  releaseStartupPreparationAttempt,
} from "../startup/startup-prepared-handoff";
import type { StartupAttemptStore } from "../startup/startup-attempt-store";
import type { AgentMessageSendReceipt } from "../../types/agent-orchestrator";
import type { SessionStartWorkflowResult } from "./session-start-workflow";
import { WorkflowLaunchFailure } from "./session-start-workflow";

const UNCONFIRMED_INSTRUCTION_DELIVERY_MESSAGE =
  "Message delivery is unconfirmed. Inspect the session before sending again.";

const settledInstructionForReceipt = (
  receipt: Exclude<AgentMessageSendReceipt, { outcome: "uncertain" }>,
): StartupInstruction => {
  switch (receipt.outcome) {
    case "queued":
      return { state: "queued" };
    case "acknowledged":
      return { state: "accepted", submissionId: receipt.submissionId };
    case "accepted":
      return { state: "accepted" };
  }
};

async function settleInstructionRetry({
  attempts,
  id,
  receipt,
  failure,
  onNotSent,
}: {
  attempts: StartupAttemptStore;
  id: string;
  receipt: AgentMessageSendReceipt | null;
  failure: string | undefined;
  onNotSent: () => void;
}): Promise<void> {
  if (receipt && receipt.outcome !== "uncertain") {
    attempts.setInstruction(id, settledInstructionForReceipt(receipt));
    attempts.setRecoveryActions(id, []);
    if (receipt.outcome !== "queued" && receipt.postAcceptanceFailure) {
      attempts.setWarning(id, receipt.postAcceptanceFailure);
    }
    await attempts.complete(id);
    return;
  }
  if (receipt?.outcome === "uncertain") {
    attempts.setInstruction(id, { state: "unknown", submissionId: receipt.submissionId });
    attempts.setRecoveryActions(id, []);
    attempts.fail(id, UNCONFIRMED_INSTRUCTION_DELIVERY_MESSAGE, false);
    return;
  }
  attempts.setInstruction(id, { state: "not_sent" });
  attempts.fail(
    id,
    failure ?? "The session is prepared. The first instruction has not been sent.",
    true,
  );
  onNotSent();
}

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
          if (!attempts.beginInstructionRetry(id)) return;
          let receipt: AgentMessageSendReceipt | null = null;
          let failure: string | undefined;
          try {
            receipt = await retryInstruction();
          } catch (cause) {
            failure = errorMessage(cause);
          }
          await settleInstructionRetry({
            attempts,
            id,
            receipt,
            failure,
            onNotSent: () => {
              installWorkflowStartupRecovery({
                queryClient,
                sessions,
                id,
                request,
                retryInstruction,
              });
            },
          });
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
          const outcome = await attempts.operation(
            id,
            (startup) =>
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
            { beforeDispatch: () => observeStartupPreparation(queryClient, request.repoPath, id) },
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
