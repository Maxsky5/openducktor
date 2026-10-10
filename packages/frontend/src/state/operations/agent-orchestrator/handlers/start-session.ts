import type {
  WorkflowLaunchRequest,
  WorkflowLaunchDecision,
  SessionLaunchActionId,
} from "@openducktor/contracts";
import { requireWorkspaceRepoPath } from "../support/session-invariants";
import type { StartAgentSessionInput, StartAgentSessionResult } from "@/types/agent-session-start";
import type { host } from "../../shared/host";

export type StartSessionDependencies = {
  repo: { workspaceRepoPath: string | null; workspaceId: string | null };
  runtime: { launchWorkflow: typeof host.agentSessionWorkflowLaunch };
};

export type { StartAgentSessionInput, StartAgentSessionResult };

/** Preparation-only callers use the same host policy as complete launches. */
export const createStartAgentSession =
  ({ repo, runtime }: StartSessionDependencies) =>
  async (input: StartAgentSessionInput): Promise<StartAgentSessionResult> => {
    const repoPath = requireWorkspaceRepoPath(repo.workspaceRepoPath);
    if (!repo.workspaceId) throw new Error("Active workspace is required.");
    let decision: WorkflowLaunchDecision;
    if (input.startMode === "reuse") {
      decision = { startMode: input.startMode, sourceSession: input.sourceSession };
    } else {
      if (!input.selectedModel.runtimeKind)
        throw new Error("Session start requires a selected runtime and model.");
      const selectedModel = {
        ...input.selectedModel,
        runtimeKind: input.selectedModel.runtimeKind,
      };
      if (input.startMode === "fork")
        decision = {
          startMode: input.startMode,
          sourceSession: input.sourceSession,
          selectedModel,
        };
      else decision = { startMode: input.startMode, selectedModel };
    }
    const request: WorkflowLaunchRequest = {
      launchAttemptId: crypto.randomUUID(),
      workspaceId: repo.workspaceId,
      repoPath,
      taskId: input.taskId,
      policy: { kind: "manual", actionId: preparationAction(input), decision },
      instruction: { kind: "none" },
    };
    if (input.startMode === "fresh" && input.targetWorkingDirectory)
      request.targetWorkingDirectory = input.targetWorkingDirectory;
    if (input.startMode === "fresh" && input.queueIfBusy) request.queueIfBusy = true;
    const outcome = await runtime.launchWorkflow(request);
    if (!outcome.session || !outcome.ownershipSaved || outcome.failure)
      throw new Error(
        outcome.failure?.message ?? "Workflow preparation returned no saved session.",
      );
    return {
      externalSessionId: outcome.session.externalSessionId,
      runtimeKind: outcome.session.runtimeKind,
      workingDirectory: outcome.session.workingDirectory,
    };
  };

const preparationAction = (input: StartAgentSessionInput): SessionLaunchActionId => {
  if (input.role === "spec") return "spec_initial";
  if (input.role === "planner") return "planner_initial";
  if (input.role === "qa") return "qa_review";
  if (input.startMode === "fork") return "build_pull_request_generation";
  if (input.startMode === "reuse") return "build_rebase_conflict_resolution";
  return "build_implementation_start";
};
