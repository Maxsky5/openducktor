import type { PlannerTools } from "@openducktor/core";

export { createAgentSessionLiveAttachment } from "./agent-session-live-attachment";

import { HostAgentSessionLiveClient } from "./agent-session-live-client";
import { HostAgentClient } from "./build-runtime-client";
import { HostClaudeRuntimeClient } from "./claude-runtime-client";
import { HostFilesystemClient } from "./filesystem-client";
import { HostGitClient } from "./git-client";
import type { InvokeFn } from "./invoke-utils";
import { HostPullRequestReviewClient } from "./pull-request-review-client";
import { HostSystemClient } from "./system-client";
import { HostTaskClient } from "./task-client";
import { TaskMetadataCache } from "./task-metadata-cache";
import { HostTerminalClient } from "./terminal-client";

export { HostInvokeError } from "./invoke-utils";
export type { InvokeFn } from "./invoke-utils";
export { HostTerminalClientError } from "./terminal-client";

import { HostWorkspaceClient } from "./workspace-client";

type PublicMethods<Client> = {
  [
    Key in keyof Client as Client[Key] extends (...args: infer _Args) => infer _Result ? Key : never
  ]: Client[Key];
};

type HostClientApi = PublicMethods<HostWorkspaceClient> &
  PublicMethods<HostFilesystemClient> &
  PublicMethods<HostPullRequestReviewClient> &
  PublicMethods<HostSystemClient> &
  PublicMethods<HostTaskClient> &
  PublicMethods<HostTerminalClient> &
  PublicMethods<HostAgentClient> &
  PublicMethods<HostAgentSessionLiveClient> &
  PublicMethods<HostClaudeRuntimeClient> &
  PublicMethods<HostGitClient>;

export type HostClient = HostClientApi & PlannerTools;

const createHostClientApi = (invokeFn: InvokeFn): HostClientApi => {
  const metadataCache = new TaskMetadataCache();
  const workspaceClient = new HostWorkspaceClient(invokeFn);
  const filesystemClient = new HostFilesystemClient(invokeFn);
  const pullRequestReviewClient = new HostPullRequestReviewClient(invokeFn);
  const systemClient = new HostSystemClient(invokeFn);
  const taskClient = new HostTaskClient(invokeFn, metadataCache);
  const terminalClient = new HostTerminalClient(invokeFn);
  const agentClient = new HostAgentClient(invokeFn, metadataCache);
  const agentSessionLiveClient = new HostAgentSessionLiveClient(invokeFn);
  const claudeRuntimeClient = new HostClaudeRuntimeClient(invokeFn);
  const gitClient = new HostGitClient(invokeFn);
  const hostClient = {
    workspaceList: workspaceClient.workspaceList.bind(workspaceClient),
    workspaceAdd: workspaceClient.workspaceAdd.bind(workspaceClient),
    workspaceSelect: workspaceClient.workspaceSelect.bind(workspaceClient),
    workspaceReorder: workspaceClient.workspaceReorder.bind(workspaceClient),
    workspaceUpdateRepoConfig: workspaceClient.workspaceUpdateRepoConfig.bind(workspaceClient),
    workspaceSaveRepoSettings: workspaceClient.workspaceSaveRepoSettings.bind(workspaceClient),
    workspaceUpdateRepoHooks: workspaceClient.workspaceUpdateRepoHooks.bind(workspaceClient),
    workspaceGetRepoConfig: workspaceClient.workspaceGetRepoConfig.bind(workspaceClient),
    workspaceReplaceAgentStudioState:
      workspaceClient.workspaceReplaceAgentStudioState.bind(workspaceClient),
    workspaceGetSettingsSnapshot:
      workspaceClient.workspaceGetSettingsSnapshot.bind(workspaceClient),
    workspaceUpdateAgentModelFavorites:
      workspaceClient.workspaceUpdateAgentModelFavorites.bind(workspaceClient),
    workspaceUpdateGlobalGitConfig:
      workspaceClient.workspaceUpdateGlobalGitConfig.bind(workspaceClient),
    workspaceDetectGithubRepository:
      workspaceClient.workspaceDetectGithubRepository.bind(workspaceClient),
    workspaceGetGitProviderContext:
      workspaceClient.workspaceGetGitProviderContext.bind(workspaceClient),
    workspaceSaveSettingsSnapshot:
      workspaceClient.workspaceSaveSettingsSnapshot.bind(workspaceClient),
    workspaceStageLocalAttachment:
      workspaceClient.workspaceStageLocalAttachment.bind(workspaceClient),
    workspaceResolveLocalAttachmentPath:
      workspaceClient.workspaceResolveLocalAttachmentPath.bind(workspaceClient),
    setTheme: workspaceClient.setTheme.bind(workspaceClient),
    filesystemListDirectory: filesystemClient.filesystemListDirectory.bind(filesystemClient),
    filesystemListTree: filesystemClient.filesystemListTree.bind(filesystemClient),
    filesystemReadTextFile: filesystemClient.filesystemReadTextFile.bind(filesystemClient),
    filesystemWriteTextFile: filesystemClient.filesystemWriteTextFile.bind(filesystemClient),
    pullRequestReviewContextGet:
      pullRequestReviewClient.pullRequestReviewContextGet.bind(pullRequestReviewClient),
    systemGetPlatform: systemClient.systemGetPlatform.bind(systemClient),
    systemListOpenInTools: systemClient.systemListOpenInTools.bind(systemClient),
    systemOpenDirectoryInTool: systemClient.systemOpenDirectoryInTool.bind(systemClient),
    tasksList: taskClient.tasksList.bind(taskClient),
    taskCreate: taskClient.taskCreate.bind(taskClient),
    taskUpdate: taskClient.taskUpdate.bind(taskClient),
    taskAssetStage: taskClient.taskAssetStage.bind(taskClient),
    taskAssetDiscardStaged: taskClient.taskAssetDiscardStaged.bind(taskClient),
    taskDelete: taskClient.taskDelete.bind(taskClient),
    taskClose: taskClient.taskClose.bind(taskClient),
    taskResetImplementation: taskClient.taskResetImplementation.bind(taskClient),
    taskReset: taskClient.taskReset.bind(taskClient),
    taskTransition: taskClient.taskTransition.bind(taskClient),
    specGet: taskClient.specGet.bind(taskClient),
    setSpec: taskClient.setSpec.bind(taskClient),
    saveSpecDocument: taskClient.saveSpecDocument.bind(taskClient),
    setPlan: taskClient.setPlan.bind(taskClient),
    savePlanDocument: taskClient.savePlanDocument.bind(taskClient),
    planGet: taskClient.planGet.bind(taskClient),
    taskMetadataGet: taskClient.taskMetadataGet.bind(taskClient),
    taskMetadataGetFresh: taskClient.taskMetadataGetFresh.bind(taskClient),
    reconcileExternalTaskSyncEvent: taskClient.reconcileExternalTaskSyncEvent.bind(taskClient),
    invalidateAllTaskMetadata: taskClient.invalidateAllTaskMetadata.bind(taskClient),
    taskDocumentGet: taskClient.taskDocumentGet.bind(taskClient),
    taskDocumentGetFresh: taskClient.taskDocumentGetFresh.bind(taskClient),
    qaGetReport: taskClient.qaGetReport.bind(taskClient),
    qaApproved: taskClient.qaApproved.bind(taskClient),
    qaRejected: taskClient.qaRejected.bind(taskClient),
    agentSessionsList: taskClient.agentSessionsList.bind(taskClient),
    agentSessionDelete: taskClient.agentSessionDelete.bind(taskClient),
    agentSessionsListForTasks: taskClient.agentSessionsListForTasks.bind(taskClient),
    taskStopImpactGet: taskClient.taskStopImpactGet.bind(taskClient),
    terminalCreate: terminalClient.terminalCreate.bind(terminalClient),
    terminalList: terminalClient.terminalList.bind(terminalClient),
    terminalPreparePathInput: terminalClient.terminalPreparePathInput.bind(terminalClient),
    terminalClose: terminalClient.terminalClose.bind(terminalClient),
    systemCheck: agentClient.systemCheck.bind(agentClient),
    runtimeCheck: agentClient.runtimeCheck.bind(agentClient),
    runtimeExecutablesCheck: agentClient.runtimeExecutablesCheck.bind(agentClient),
    taskStoreCheck: agentClient.taskStoreCheck.bind(agentClient),
    runtimeDefinitionsList: agentClient.runtimeDefinitionsList.bind(agentClient),
    runtimeList: agentClient.runtimeList.bind(agentClient),
    taskWorktreeGet: agentClient.taskWorktreeGet.bind(agentClient),
    runtimeStop: agentClient.runtimeStop.bind(agentClient),
    runtimeEnsure: agentClient.runtimeEnsure.bind(agentClient),
    runtimeRequire: agentClient.runtimeRequire.bind(agentClient),
    repoRuntimeHealth: agentClient.repoRuntimeHealth.bind(agentClient),
    repoRuntimeHealthStatus: agentClient.repoRuntimeHealthStatus.bind(agentClient),
    codexAppServerRequest: agentClient.codexAppServerRequest.bind(agentClient),
    buildStart: agentClient.buildStart.bind(agentClient),
    devServerGetState: agentClient.devServerGetState.bind(agentClient),
    devServerStart: agentClient.devServerStart.bind(agentClient),
    devServerStop: agentClient.devServerStop.bind(agentClient),
    devServerRestart: agentClient.devServerRestart.bind(agentClient),
    buildBlocked: agentClient.buildBlocked.bind(agentClient),
    buildResumed: agentClient.buildResumed.bind(agentClient),
    buildCompleted: agentClient.buildCompleted.bind(agentClient),
    taskApprovalContextGet: agentClient.taskApprovalContextGet.bind(agentClient),
    taskDirectMerge: agentClient.taskDirectMerge.bind(agentClient),
    taskDirectMergeComplete: agentClient.taskDirectMergeComplete.bind(agentClient),
    taskPullRequestUpsert: agentClient.taskPullRequestUpsert.bind(agentClient),
    taskPullRequestUnlink: agentClient.taskPullRequestUnlink.bind(agentClient),
    taskPullRequestDetect: agentClient.taskPullRequestDetect.bind(agentClient),
    taskPullRequestLinkMerged: agentClient.taskPullRequestLinkMerged.bind(agentClient),
    repoPullRequestSync: agentClient.repoPullRequestSync.bind(agentClient),
    humanRequestChanges: agentClient.humanRequestChanges.bind(agentClient),
    humanApprove: agentClient.humanApprove.bind(agentClient),
    agentSessionStop: agentClient.agentSessionStop.bind(agentClient),
    agentSessionControlFork:
      agentSessionLiveClient.agentSessionControlFork.bind(agentSessionLiveClient),
    agentSessionControlRelease:
      agentSessionLiveClient.agentSessionControlRelease.bind(agentSessionLiveClient),
    agentSessionControlResume:
      agentSessionLiveClient.agentSessionControlResume.bind(agentSessionLiveClient),
    agentSessionControlSend:
      agentSessionLiveClient.agentSessionControlSend.bind(agentSessionLiveClient),
    agentSessionControlStart:
      agentSessionLiveClient.agentSessionControlStart.bind(agentSessionLiveClient),
    agentSessionWorkflowStart:
      agentSessionLiveClient.agentSessionWorkflowStart.bind(agentSessionLiveClient),
    agentSessionControlStop:
      agentSessionLiveClient.agentSessionControlStop.bind(agentSessionLiveClient),
    agentSessionControlUpdateModel:
      agentSessionLiveClient.agentSessionControlUpdateModel.bind(agentSessionLiveClient),
    agentSessionLiveList: agentSessionLiveClient.agentSessionLiveList.bind(agentSessionLiveClient),
    agentSessionLiveLoadContext:
      agentSessionLiveClient.agentSessionLiveLoadContext.bind(agentSessionLiveClient),
    agentSessionLiveLoadDiff:
      agentSessionLiveClient.agentSessionLiveLoadDiff.bind(agentSessionLiveClient),
    agentSessionLiveRead: agentSessionLiveClient.agentSessionLiveRead.bind(agentSessionLiveClient),
    agentSessionLiveRefresh:
      agentSessionLiveClient.agentSessionLiveRefresh.bind(agentSessionLiveClient),
    agentSessionLiveReplyApproval:
      agentSessionLiveClient.agentSessionLiveReplyApproval.bind(agentSessionLiveClient),
    agentSessionLiveReplyQuestion:
      agentSessionLiveClient.agentSessionLiveReplyQuestion.bind(agentSessionLiveClient),
    claudeRuntimeFileStatus: claudeRuntimeClient.claudeRuntimeFileStatus.bind(claudeRuntimeClient),
    claudeRuntimeListModels: claudeRuntimeClient.claudeRuntimeListModels.bind(claudeRuntimeClient),
    claudeRuntimeListSkills: claudeRuntimeClient.claudeRuntimeListSkills.bind(claudeRuntimeClient),
    claudeRuntimeListSlashCommands:
      claudeRuntimeClient.claudeRuntimeListSlashCommands.bind(claudeRuntimeClient),
    claudeRuntimeListSubagents:
      claudeRuntimeClient.claudeRuntimeListSubagents.bind(claudeRuntimeClient),
    claudeRuntimeLoadSessionDiff:
      claudeRuntimeClient.claudeRuntimeLoadSessionDiff.bind(claudeRuntimeClient),
    claudeRuntimeLoadSessionHistory:
      claudeRuntimeClient.claudeRuntimeLoadSessionHistory.bind(claudeRuntimeClient),
    claudeRuntimeLoadSessionTodos:
      claudeRuntimeClient.claudeRuntimeLoadSessionTodos.bind(claudeRuntimeClient),
    claudeRuntimeSearchFiles:
      claudeRuntimeClient.claudeRuntimeSearchFiles.bind(claudeRuntimeClient),
    gitCanonicalizePath: gitClient.gitCanonicalizePath.bind(gitClient),
    gitGetBranches: gitClient.gitGetBranches.bind(gitClient),
    gitGetCurrentBranch: gitClient.gitGetCurrentBranch.bind(gitClient),
    gitSwitchBranch: gitClient.gitSwitchBranch.bind(gitClient),
    gitCreateWorktree: gitClient.gitCreateWorktree.bind(gitClient),
    gitRemoveWorktree: gitClient.gitRemoveWorktree.bind(gitClient),
    gitPushBranch: gitClient.gitPushBranch.bind(gitClient),
    gitPullBranch: gitClient.gitPullBranch.bind(gitClient),
    gitFetchRemote: gitClient.gitFetchRemote.bind(gitClient),
    gitCommitAll: gitClient.gitCommitAll.bind(gitClient),
    gitRebaseBranch: gitClient.gitRebaseBranch.bind(gitClient),
    gitRebaseAbort: gitClient.gitRebaseAbort.bind(gitClient),
    gitAbortConflict: gitClient.gitAbortConflict.bind(gitClient),
    gitGetStatus: gitClient.gitGetStatus.bind(gitClient),
    gitGetDiff: gitClient.gitGetDiff.bind(gitClient),
    gitCommitsAheadBehind: gitClient.gitCommitsAheadBehind.bind(gitClient),
    gitGetWorktreeStatus: gitClient.gitGetWorktreeStatus.bind(gitClient),
    gitGetWorktreeStatusSummary: gitClient.gitGetWorktreeStatusSummary.bind(gitClient),
    gitResetWorktreeSelection: gitClient.gitResetWorktreeSelection.bind(gitClient),
  } satisfies HostClientApi;
  for (const methodName of Object.keys(hostClient)) {
    Object.defineProperty(hostClient, methodName, { enumerable: false });
  }
  return hostClient;
};

export function createHostClient(invokeFn: InvokeFn): HostClient {
  return createHostClientApi(invokeFn);
}
