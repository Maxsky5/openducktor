import { builtinTaskWorkflowResolver, workflowRolePolicies } from "./task-workflow-composition";
import { createNodeWorkflowCommandHandlers } from "./node-workflow-command-handlers";
import {
  createWorkflowWorkspaceObservation,
  createWorkflowObservationInitializer,
  createWorkflowLiveObserver,
  workflowShutdown,
} from "./workflow-workspace-observation";
import { createEffectHostCommandRouter } from "../../interface/router/host-command-router";
import { createRuntimeAdmissionGate } from "@openducktor/runtime-orchestration";
import { createNodeNotificationServices } from "./node-notification-services";
import { createNotificationCommandHandlers } from "../../interface/commands/notification-command-handlers";
import { createNodeKeyboardShortcutHandlers } from "./node-keyboard-shortcut-handlers";
import { createNodeSessionAutomation } from "./node-session-automation";
import { createNodeImageCommandHandlers } from "./node-image-command-handlers";
import { createNodeLocalToolCommandHandlers } from "./node-local-tool-command-handlers";
import { createNodeGitProviderCommandHandlers } from "./node-git-provider-command-handlers";
import { createNodeMcpHostBridge } from "./node-mcp-host-bridge";
import { withTaskWorkflowSettings } from "../../application/workspaces/task-workflow-settings";
import { createNodeWorkspaceProviderSetup } from "./node-workspace-provider-setup";
import { Effect } from "effect";
import { createLocalAttachmentService } from "../../application/attachments/local-attachment-service";
import { createWorkspaceFilesService } from "../../application/filesystem/workspace-files-service";
import { createWorkspaceActivityInspector } from "../../application/workspaces/workspace-activity-inspector";
import { createWorkspaceLifecycleService } from "../../application/workspaces/workspace-lifecycle-service";
import { createRemoteFetchService } from "../../application/git/remote-fetch-service";
import { createPullRequestReviewService } from "../../application/pull-requests/pull-request-review-service";
import { createRuntimeAdmissionPort } from "../../application/runtimes/host-runtime-ports";
import { createTaskSessionStopService } from "../../application/tasks/task-session-stop-service";
import { createTaskSessionLifecycleCoordinator } from "../../application/tasks/worktrees/task-session-lifecycle-coordinator";
import { createTaskWorktreeService } from "../../application/tasks/worktrees/task-worktree-service";
import { createRepoActionService } from "../../application/actions/repo-action-service";
import { createWorktreeActionRunner } from "../../application/actions/worktree-action-runner";
import { createNodeTerminalService } from "./node-terminal-composition";
import { createNodeSessionLaunchControls } from "./node-session-launch-controls";
import {
  resolveSessionMessageParts,
  resolvePreparedSessionAttachments,
} from "../../application/attachments/resolve-session-message-parts";
import type { GitProviderResolver } from "../../application/git/git-provider-resolver";
import type { AzureDevOpsConnectionPort } from "../../ports/azure-devops-connection-port";
import type { AzureAreaPathsPort } from "../../ports/azure-area-paths-port";
import { createLocalAttachmentCommandHandlers } from "../../interface/commands/local-attachment-command-handlers";
import { createPullRequestReviewCommandHandlers } from "../../interface/commands/pull-request-review-command-handlers";
import { createRuntimeDefinitionsCommandHandlers } from "../../interface/commands/runtime-definitions-command-handlers";
import { createRuntimeCommandHandlers } from "../../interface/commands/runtime-command-handlers";
import { createRepoActionCommandHandlers } from "../../interface/commands/repo-action-command-handlers";
import { createTerminalCommandHandlers } from "../../interface/commands/terminal-command-handlers";
import { createWorkspaceFilesCommandHandlers } from "../../interface/commands/workspace-files-command-handlers";
import { createWorkspaceLifecycleCommandHandlers } from "../../interface/commands/workspace-lifecycle-command-handlers";
import { createWorkspaceSettingsCommandHandlers } from "../../interface/commands/workspace-settings-command-handlers";
import { createHostRuntimeDefinitionsService } from "./create-host-runtime-definitions-service";
import type {
  CreateNodeHostCommandRouterInput,
  EffectNodeHostCommandRouter,
} from "./node-host-command-router-types";
import { createNodeAgentSessionLiveState } from "./node-agent-session-live-state";
import { createNodeMessageDelivery } from "./node-message-delivery";
import { createLiveSessionFaultLogger, defaultLifecycleLogger } from "./node-host-lifecycle-logger";
import { createNodeRuntimeExecutableCommandHandlers } from "./node-runtime-executable-command-handlers";
import { createNodeHostRouterLifecycle } from "./node-host-router-lifecycle";
import type { NodeHostSharedPorts } from "./node-shared-storage";
import { createNodeBrowser } from "./node-browser-composition";
import { createNodeWorkspaceStorageRemoval } from "./node-workspace-storage-removal";
import type { NodeGitlabComposition } from "./git-provider-composition";
import { createGitlabConnectionCommandHandlers } from "../../interface/commands/gitlab-connection-command-handlers";
import { createBrowserCommandHandlers } from "../../interface/commands/browser-command-handlers";
import { createNodeHostRuntimeComposition } from "./node-host-runtime-composition";
import { createNodeTaskAssetServices } from "./node-task-asset-services";
import { createNodeNaming } from "./node-naming";
import { createNodeTaskSessionServices } from "./node-task-session-services";
import { createNodeWorkspaceSessionPersistence } from "./node-workspace-session-persistence";
import { createNodeWorkspaceSessionServices } from "./node-workspace-session-services";
import { createClaudeSessionMetadataAdapter } from "../../adapters/claude/claude-session-metadata-adapter";
import { createNodeSessionStartupTracker } from "./node-session-startup-progress";
export type { CreateNodeHostCommandRouterInput, EffectNodeHostCommandRouter };
export const assembleNodeEffectHostCommandRouter = (
  input: CreateNodeHostCommandRouterInput,
  defaultPorts: NodeHostSharedPorts,
  gitProviderResolver: GitProviderResolver,
  azureDevOpsConnection: AzureDevOpsConnectionPort | undefined,
  azureAreaPaths: AzureAreaPathsPort,
  gitlab: NodeGitlabComposition,
): EffectNodeHostCommandRouter => {
  const {
    clientVersion,
    eventBus,
    lifecycleLogger = defaultLifecycleLogger,
    mcpHostBridge,
    onBackgroundFailure,
    runtimeStarter: configuredRuntimeStarter,
    taskStore: configuredTaskStore,
    taskEventPublicationReporter,
    taskWorkflows = builtinTaskWorkflowResolver,
  } = input;
  const {
    filesystem,
    git,
    localAttachments,
    configDir,
    runtimeHealth,
    settingsConfig: baseSettingsConfig,
    systemCommands,
    browserEngine,
    browserAutomation,
    toolDiscovery,
    readEnv,
    startupEnv,
    worktreeFiles,
  } = defaultPorts;
  const automation = createNodeSessionAutomation(onBackgroundFailure, lifecycleLogger, git);
  const notificationComposition = createNodeNotificationServices(
    withTaskWorkflowSettings(baseSettingsConfig, taskWorkflows),
    eventBus,
    automation.configCommitted,
  );
  const { settingsConfig } = notificationComposition;
  const setup = createNodeWorkspaceProviderSetup(
    { ...defaultPorts, settingsConfig },
    { ...input, gitlab },
    (repoPath) => observeWorkflowWorkspace(repoPath),
    taskWorkflows,
  );
  const { workspaceSettingsService, workspaceProviderSetup, workspaceAdmissionService } = setup;
  const claudeSessionMetadata = createClaudeSessionMetadataAdapter(readEnv);
  const assets = createNodeTaskAssetServices({
    configDir,
    contextManager: defaultPorts.taskDatabase,
    resolveTaskStoreAccess: workspaceAdmissionService.resolveTaskStoreAccess,
    configuredTaskStore,
    isWorkspaceBlocked: workspaceAdmissionService.isWorkspaceBlocked,
    onBackgroundFailure,
    workspaceSettingsService,
  });
  const { startupSweep, taskAssetReadService, taskAssetStagingService, taskStore } = assets;
  const { textGeneration, naming } = createNodeNaming(settingsConfig, () => ({
    runtimeRegistry,
    adapterRegistry: liveSessionAdapterRegistry,
  }));
  const workspaceSessions = createNodeWorkspaceSessionPersistence({
    taskStore,
    store: assets.workspaceSessionStore,
    settings: workspaceSettingsService,
    naming,
    git,
    eventBus,
    faultLog: createLiveSessionFaultLogger(lifecycleLogger),
    updateRuntimeSessionTitle: (input) => agentSessionLiveStateService.updateSessionTitle(input),
  });
  const runtimeDefinitionsService = createHostRuntimeDefinitionsService();
  const messageDelivery = createNodeMessageDelivery({
    eventBus,
    onBackgroundFailure,
    canonicalizeRepoPath: (repoPath) => git.canonicalizePath(repoPath),
    prepare: (content) =>
      resolvePreparedSessionAttachments(
        agentSessionCommandService.prepareUserMessage(content),
        localAttachmentService,
      ),
    runOperation: (target, work, submissionId) =>
      agentSessionCommandService.runMessageOperation(target, work, submissionId),
    commitQueueResume: (commit) => agentSessionCommandService.commitQueueResume(commit),
    prepareQueueResume: (content) => agentSessionCommandService.prepareQueueResume(content),
    send: (input, options) => launchControls.commands.sendUserMessage(input, options),
    runtimeRegistry: { status: (kind) => runtimeRegistry.status(kind) },
    runtimeDefinitions: runtimeDefinitionsService,
  });
  const runtimeAdmissionGate = createRuntimeAdmissionGate();
  const runtimeAdmission = createRuntimeAdmissionPort(runtimeAdmissionGate);
  const { liveSessionAdapterRegistry, agentSessionLiveStateService, runtimeQueryInputs } =
    createNodeAgentSessionLiveState({
      runtimeAdmission,
      observeNotificationInput: notificationComposition.acceptLive,
      observeWorkflowInput: createWorkflowLiveObserver(
        () => taskSessions,
        messageDelivery.runBackground,
        automation.observeLive,
      ),
      onRuntimeRegistered: automation.runtimeRegistered,
      messageQueues: messageDelivery,
      persistence: workspaceSessions.persistence,
      withProcessStartAdmission: workspaceAdmissionService.withProcessStartAdmission,
      store: workspaceSessions.store,
      settings: workspaceSettingsService,
      eventBus,
      lifecycleLogger,
    });
  const remoteFetch = createRemoteFetchService(git);
  const localAttachmentService = createLocalAttachmentService(localAttachments);
  const workingDirectoryDependencies = { gitPort: git, settingsConfig, workspaceSettingsService };
  let resolvedMcpHostBridge = mcpHostBridge;
  const taskSessionLifecycleCoordinator = createTaskSessionLifecycleCoordinator();
  const {
    hostInstanceId,
    hostRuntimeService,
    registry: runtimeRegistry,
  } = createNodeHostRuntimeComposition({
    clientVersion,
    hostInstanceId: defaultPorts.hostInstanceId,
    configuredRuntimeStarter,
    defaultPorts,
    eventBus,
    lifecycleLogger,
    liveState: agentSessionLiveStateService,
    onBackgroundFailure,
    resolveBridge: () => resolvedMcpHostBridge,
    resolveWorkflowRolePolicy: workflowRolePolicies(taskWorkflows),
    runtimeAdmissionGate,
    runtimeDefinitionsService,
    settingsConfig,
    taskSessionLifecycleCoordinator,
    workingDirectoryDependencies,
    workspaceSettingsService,
  });
  const taskWorktreeService = createTaskWorktreeService({
    settingsConfig,
    workspaceSettingsService,
  });
  const terminalService = createNodeTerminalService({
    ports: defaultPorts,
    admission: workspaceAdmissionService,
    taskWorktrees: taskWorktreeService,
    settings: workspaceSettingsService,
    sessions: assets.workspaceSessionStore,
  });
  const { browserService, ...callers } = createNodeBrowser({
    engine: browserEngine,
    automation: browserAutomation,
    configRoot: configDir.root,
    settings: workspaceSettingsService,
    git,
    tasks: taskStore,
    workspaceSessions: workspaceSessions.store,
    liveSessions: liveSessionAdapterRegistry,
    localAttachments: localAttachmentService,
    eventBus,
    lifecycleLogger,
  });
  const repoActionService = createRepoActionService({
    terminals: terminalService,
    settings: workspaceSettingsService,
  });
  const worktreeActions = createWorktreeActionRunner(terminalService);
  const workspaceLifecycleService = createWorkspaceLifecycleService({
    onWorkspaceReopened: (repoPath) => observeWorkflowWorkspace(repoPath),
    activity: createWorkspaceActivityInspector({ agentSessionLiveStateService, terminalService }),
    admission: workspaceAdmissionService,
    gitPort: git,
    settingsConfig,
    storage: createNodeWorkspaceStorageRemoval({
      taskAssets: assets,
      azureDevOpsConnection,
      gitlabConnection: gitlab.connection,
      browserService,
    }),
    taskSessionLifecycleCoordinator,
    taskStore,
    taskOwnership: assets.taskOwnership,
    workspaceSettingsService,
    worktreeFiles,
  });
  const taskSessions = createNodeTaskSessionServices({
    hostInstanceId,
    naming,
    runtimeAdmission,
    taskServiceInput: {
      terminalService,
      browserTabs: browserService,
      worktreeActions,
      gitPort: git,
      gitProviderResolver,
      taskStore,
      taskWorkflows,
      settingsConfig,
      systemCommands,
      toolDiscovery,
      taskWorktreeService,
      workspaceSettingsService,
      runtimeDefinitionsService,
      runtimeRegistry,
      worktreeFiles,
      taskSessionLifecycleCoordinator,
    },
    eventServiceInput: {
      acceptNotificationInput: notificationComposition.acceptTask,
      notifyAutoCloseBlocked: notificationComposition.acceptAutoCloseBlocked,
      observeStatusChanges: automation.observeStatusChanges,
      lifecycleLogger,
      onBackgroundFailure,
      taskEventPublicationReporter,
      workspaceSettingsService,
    },
    publishMergeStatus: (snapshot) =>
      eventBus?.publish({ channel: "openducktor://task-merge-status-updated", payload: snapshot }),
    remoteFetch,
    canonicalizeRepoPath: (repoPath) => git.canonicalizePath(repoPath),
    agentSessionLiveStateService,
    workspaceSessions,
    pauseForStop: messageDelivery.pauseForStop,
    savedSessions: assets,
    claudeSessionMetadata,
    workflowLaunch: {
      messageDelivery,
      resolveParts: (parts) => resolveSessionMessageParts(parts, localAttachmentService),
      ...runtimeQueryInputs,
    },
  });
  const observeWorkflowWorkspace = createWorkflowWorkspaceObservation(
    agentSessionLiveStateService,
    onBackgroundFailure,
    messageDelivery.runBackground,
  );
  const { taskEventStream, taskService, taskSyncService, agentSessionCommandService } =
    taskSessions;
  const notificationService = notificationComposition.attach({
    taskWorkflows,
    tasks: taskService,
    live: agentSessionLiveStateService,
    workspaceSessions: workspaceSessions.store,
  });
  const automationServices = automation.create({
    autopilot: {
      publish: (payload) => eventBus?.publish({ channel: "openducktor://run-event", payload }),
      taskWorkflows,
      notifications: notificationService,
    },
    autoResume: {
      live: agentSessionLiveStateService,
      readRoots: workspaceSessions.readSessionRootRefs,
      settings: workspaceSettingsService,
      adapters: liveSessionAdapterRegistry,
    },
    taskSessions,
    settingsConfig,
  });
  const pullRequestReviewService = createPullRequestReviewService({
    resolver: gitProviderResolver,
    taskReader: taskStore,
    workspaceSettingsService,
  });
  resolvedMcpHostBridge ??= createNodeMcpHostBridge({
    taskWorkflows,
    browserAgentTools: browserService,
    ...callers,
    taskAssetReadService,
    taskService,
    workspaceSettingsService,
    discoveryMode: input.mcpBridgeDiscoveryMode,
    eventBus,
    hostInstanceId,
    startupEnv,
  });
  const taskSessionStopService = createTaskSessionStopService({
    gitPort: git,
    runtimeDefinitionsService,
    runtimeRegistry,
    taskReader: taskStore,
  });
  const workspaceChats = createNodeWorkspaceSessionServices({
    terminalService,
    browserTabs: browserService,
    lifecycle: taskSessionLifecycleCoordinator,
    ...workspaceSessions,
    taskOwnership: assets.taskOwnership,
    settings: workspaceSettingsService,
    runtime: runtimeRegistry,
    runtimeAdmission,
    live: agentSessionLiveStateService,
    commands: agentSessionCommandService,
    resolveParts: (parts) => resolveSessionMessageParts(parts, localAttachmentService),
    git,
    settingsConfig,
    worktreeFiles,
    worktreeActions,
    registry: liveSessionAdapterRegistry,
    eventBus,
    claudeSessionMetadata,
  });
  const workspaceFiles = workspaceChats.scopeFiles(createWorkspaceFilesService(filesystem, git));
  const launchControls = createNodeSessionLaunchControls(agentSessionCommandService, [
    taskSessions.workflowLaunchService,
    workspaceChats.workspaceSessionLaunchService,
  ]);
  const hostRouterLifecycle = createNodeHostRouterLifecycle({
    initializeAdmission: createWorkflowObservationInitializer(
      workspaceAdmissionService,
      workspaceSettingsService,
      agentSessionLiveStateService,
    ),
    shutdownWorkspaceImports: workspaceChats.workspaceSessionImports.shutdown,
    shutdownWorkspaceSessionPersistence: workspaceSessions.persistence.shutdown,
    shutdownMessageDeliveries: messageDelivery.shutdown,
    unsubscribeImportCatalogs: workspaceChats.unsubscribeImportCatalogs,
    notifications: notificationService,
    ...automationServices.lifecycle,
    assets,
    azureDevOpsConnection,
    workspaceProviderSetup,
    imageWorkers: defaultPorts.imageWorkers,
    shutdownWorkspaceFiles: () =>
      workspaceFiles.dispose().pipe(Effect.andThen(git.releaseReadCaptures())),
    lifecycleLogger,
    mcpHostBridge: resolvedMcpHostBridge,
    runtimeRegistry,
    initializeRuntimes: hostRuntimeService.initialize,
    // Deletes unlinked GitLab accounts. The sweep logs its failures, so it cannot stop the startup.
    startupSweep: () => startupSweep().pipe(Effect.andThen(gitlab.connection.sweep())),
    taskAssetStagingService,
    taskSyncService,
    mergeDetection: taskSessions.mergeDetection,
    terminalService,
    browserService,
    sessionLaunches: {
      ...launchControls,
      shutdown: () => workflowShutdown(launchControls, agentSessionCommandService, taskSessions),
    },
  });
  const handlers = {
    ...setup.handlers,
    ...workspaceChats.handlers,
    ...createNotificationCommandHandlers(notificationService),
    ...automationServices.handlers,
    ...createNodeWorkflowCommandHandlers({
      launchControls,
      messageDelivery,
      taskSessions,
      defaultPorts,
      git,
      runtimeDefinitionsService,
      clientVersion,
      runtimeRegistry,
      adapterRegistry: liveSessionAdapterRegistry,
      textGeneration,
      taskAssetStagingService,
      taskWorktreeService,
    }),
    ...createWorkspaceFilesCommandHandlers(workspaceFiles),
    ...createNodeGitProviderCommandHandlers({
      resolver: gitProviderResolver,
      issueImportStore: assets.issueImportStore,
      taskWorkflows,
      taskSyncService,
      workspaceSettingsService,
      azureDevOpsConnection,
      azureAreaPaths,
    }),
    ...createGitlabConnectionCommandHandlers({ connection: gitlab.connection }),
    ...createLocalAttachmentCommandHandlers(localAttachmentService),
    ...createNodeImageCommandHandlers(
      liveSessionAdapterRegistry,
      defaultPorts.generatedImageFiles,
      runtimeDefinitionsService,
      { ...workingDirectoryDependencies, worktreeFiles },
    ),
    ...createPullRequestReviewCommandHandlers(pullRequestReviewService),
    ...createRuntimeDefinitionsCommandHandlers(runtimeDefinitionsService),
    ...createNodeRuntimeExecutableCommandHandlers({
      runtimeDefinitionsService,
      runtimeHealth,
      toolDiscovery,
    }),
    ...createRuntimeCommandHandlers(taskSessionStopService, hostRuntimeService, () =>
      resolvedMcpHostBridge.status(),
    ),
    ...createNodeLocalToolCommandHandlers({
      ...defaultPorts,
      settingsConfig,
      assets,
      workspaceSettings: workspaceSettingsService,
      remoteFetch,
    }),
    ...createTerminalCommandHandlers(terminalService),
    ...createBrowserCommandHandlers(browserService),
    ...createRepoActionCommandHandlers(repoActionService),
    ...createWorkspaceSettingsCommandHandlers(workspaceSettingsService, hostRuntimeService),
    ...createNodeKeyboardShortcutHandlers(settingsConfig, eventBus),
    ...createWorkspaceLifecycleCommandHandlers(workspaceSettingsService, workspaceLifecycleService),
  };
  const router = createEffectHostCommandRouter({
    ...hostRouterLifecycle,
    handlers,
    trackCommand: createNodeSessionStartupTracker({
      hostInstanceId,
      eventBus,
      settings: workspaceSettingsService,
      taskWorkflows,
      finalize: agentSessionLiveStateService.finalizeStartupPreparation,
      runtime: runtimeRegistry,
    }),
  });
  return Object.assign(router, {
    hostInstanceId,
    hostSettings: workspaceSettingsService,
    taskAssetReadService,
    taskEventStream,
    notificationStream: notificationService.stream,
    terminalService,
    browserService,
  });
};
