import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { useClientConnection } from "../../connection/client-connection-react";
import { projectWorkflowLaunch } from "../agent-orchestrator/session-read-model/workflow-launch-projection";
import { useAgentOperationsContext, useAgentSessionsContext } from "../session-contexts";
import {
  createSessionStartWorkflowRunner,
  type RunSessionStartWorkflow,
  type SessionStartNotificationPublisher,
} from "./session-start-orchestration";
import { withWorktreeRefresh } from "./with-worktree-refresh";
import { observeStartupPreparation } from "../startup/startup-prepared-handoff";
import { errorMessage } from "../../lib/errors";
import type { WorkflowLaunchRequest } from "@openducktor/contracts";
import { installWorkflowStartupRecovery } from "./workflow-startup-recovery";

/** Runs task launches and retains their progress in the originating connection. */
export function useSessionStartWorkflowRunner({
  workspaceId,
  repoPath,
  notifications,
}: {
  workspaceId: string | null;
  repoPath: string | null;
  notifications?: SessionStartNotificationPublisher | undefined;
}): RunSessionStartWorkflow {
  const store = useAgentSessionsContext();
  const queryClient = useQueryClient();
  const {
    host: { client: host },
    startupAttempts,
  } = useClientConnection();
  const { sendAgentMessage } = useAgentOperationsContext();
  const inlineAttempts = useRef(new Set<string>());
  useEffect(
    () => () => {
      for (const id of inlineAttempts.current)
        if (startupAttempts.getAttempt(id)?.presentation === "inline")
          startupAttempts.continueInBackground(id);
    },
    [startupAttempts, workspaceId, repoPath],
  );
  return useMemo(
    () => async (input) => {
      if (!workspaceId || !repoPath)
        throw new Error("Session start requires an explicit workspace and repository.");
      const origin = {
        workspaceId,
        repoPath,
        scope: { kind: "task" as const, taskId: input.request.taskId, role: input.request.role },
      };
      const existing = input.startupAttemptId
        ? startupAttempts.getAttempt(input.startupAttemptId)
        : null;
      if (
        input.startupAttemptId &&
        (!existing ||
          existing.origin.workspaceId !== workspaceId ||
          existing.origin.repoPath !== repoPath ||
          existing.origin.scope.kind !== "task" ||
          existing.origin.scope.taskId !== input.request.taskId ||
          existing.origin.scope.role !== input.request.role)
      )
        throw new Error("The session start no longer belongs to this workspace and task.");
      const id =
        existing?.id ??
        startupAttempts.begin({
          origin,
          label: `Start ${input.request.role} session`,
          presentation: "inline",
          instructionRequired: input.request.postStartAction !== "none",
        });
      if (!existing) inlineAttempts.current.add(id);
      let launchRequest: WorkflowLaunchRequest | null = null;
      const runner = createSessionStartWorkflowRunner({
        workspaceId,
        repoPath,
        sendAgentMessage,
        notifications,
        launchAttemptId: id,
        client: {
          agentSessionWorkflowLaunch: withWorktreeRefresh(queryClient, async (request) => {
            launchRequest = request;
            await observeStartupPreparation(queryClient, repoPath, id).catch((cause) => {
              startupAttempts.rejectBeforeDispatch(id, errorMessage(cause));
              throw cause;
            });
            const outcome = await startupAttempts.operation(id, (startup) =>
              host.agentSessionWorkflowLaunch({ ...request, startup }),
            );
            if (outcome.acceptedMessage) startupAttempts.setInstruction(id, { state: "accepted" });
            // A display failure must not undo the host outcome or permit a message resend.
            try {
              projectWorkflowLaunch(store, queryClient, outcome);
            } catch (cause) {
              console.error("Cannot project the launched workflow session.", cause);
            }
            if (outcome.status === "completed" && outcome.startupProgress?.prepared) {
              await startupAttempts.complete(id);
            } else if (outcome.status === "completed") {
              startupAttempts.fail(
                id,
                "Session preparation is unconfirmed. Inspect the saved session before you try again.",
                false,
              );
            }
            return outcome;
          }),
        },
      });
      try {
        const result = await runner(input);
        if (
          result.postStartActionError &&
          startupAttempts.getAttempt(id)?.status.phase !== "canceled"
        )
          startupAttempts.fail(id, result.postStartActionError.message);
        if (result.retryPostStartMessage) startupAttempts.setInstruction(id, { state: "not_sent" });
        if (launchRequest)
          installWorkflowStartupRecovery({
            queryClient,
            sessions: store,
            id,
            request: launchRequest,
            retryInstruction: result.retryPostStartMessage,
          });
        return result;
      } catch (cause) {
        const attempt = startupAttempts.getAttempt(id);
        if (!launchRequest) startupAttempts.rejectBeforeDispatch(id, errorMessage(cause));
        else if (attempt && !["ready", "failed", "canceled"].includes(attempt.status.phase))
          startupAttempts.fail(id, errorMessage(cause), false);
        if (launchRequest)
          installWorkflowStartupRecovery({
            queryClient,
            sessions: store,
            id,
            request: launchRequest,
          });
        throw cause;
      }
    },
    [
      host,
      workspaceId,
      repoPath,
      sendAgentMessage,
      notifications,
      store,
      queryClient,
      startupAttempts,
    ],
  );
}
