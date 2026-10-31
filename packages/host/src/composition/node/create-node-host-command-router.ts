import { builtinTaskWorkflowResolver, workflowRolePolicies } from "./task-workflow-composition";
import { createNodeWorkflowCommandHandlers } from "./node-workflow-command-handlers";
import {
  createWorkflowWorkspaceObservation,
  initializeWorkflowObservation,
  createWorkflowLiveObserver,
  workflowShutdown,
} from "./workflow-workspace-observation";
import { createLiveSessionRootRefsReader } from "./live-session-root-refs";
import { createEffectHostCommandRouter } from "../../interface/router/host-command-router";
import { createRuntimeAdmissionGate } from "@openducktor/runtime-orchestration";
import { createNodeNotificationServices } from "./node-notification-services";
import { createNotificationCommandHandlers } from "../../interface/commands/notification-command-handlers";
import { createAutopilotCommandHandlers } from "../../interface/commands/autopilot-command-handlers";
import {
  type AutopilotService,
  createAutopilotService,
} from "../../application/autopilot/autopilot-service";
import { withConfigCommit } from "../../adapters/config/config-commit";
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
import { createTerminalService } from "../../application/terminals/terminal-service";
import { createNodeSessionLaunchControls } from "./node-session-launch-controls";
import {
  resolveSessionMessageParts,
  resolvePreparedSessionAttachments,
} from "../../application/attachments/resolve-session-message-parts";
import type { GitProviderResolver } from "../../application/git/git-provider-resolver";
import type { AzureDevOpsConnectionPort } from "../../ports/azure-devops-connection-port";
import type { AzureAreaPathsPort } from "../../ports/azure-area-paths-port";
import { createTerminalLaunchEnvironment } from "../../infrastructure/terminals/terminal-launch-environment";
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
import type { NodeHostDefaultPorts } from "./node-host-default-ports";
import { createNodeAgentSessionLiveState } from "./node-agent-session-live-state";
import { createNodeMessageDelivery } from "./node-message-delivery";
import { createLiveSessionFaultLogger, defaultLifecycleLogger } from "./node-host-lifecycle-logger";
import { createNodeRuntimeExecutableCommandHandlers } from "./node-runtime-executable-command-handlers";
import { createNodeHostRouterLifecycle } from "./node-host-router-lifecycle";
import { createNodeBrowser } from "./node-browser-composition";
import { createNodeWorkspaceStorageRemoval } from "./node-workspace-storage-removal";
import { createBrowserCommandHandlers } from "../../interface/commands/browser-command-handlers";
import { createNodeHostRuntimeComposition } from "./node-host-runtime-composition";
import { createNodeTaskAssetServices } from "./node-task-asset-services";
import { createNodeTaskSessionServices } from "./node-task-session-services";
import { createNodeWorkspaceSessionPersistence } from "./node-workspace-session-persistence";
import { createNodeWorkspaceSessionServices } from "./node-workspace-session-services";
import { createNodeSessionStartupTracker } from "./node-session-startup-progress";
export type { CreateNodeHostCommandRouterInput, EffectNodeHostCommandRouter };
export const assembleNodeEffectHostCommandRouter = (
  input: CreateNodeHostCommandRouterInput,
  defaultPorts: NodeHostDefaultPorts,
  gitProviderResolver: GitProviderResolver,
  azureDevOpsConnection: AzureDevOpsConnectionPort | undefined,
  azureAreaPaths: AzureAreaPathsPort,
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
    terminalPty,
    browserEngine,
    browserAutomation,
    toolDiscovery,
    readEnv,
    startupEnv,
    worktreeFiles,
  } = defaultPorts;
  let autopilot: AutopilotService | undefined; // Autopilot needs services that this function creates later, so the hooks bind it late.
  const notificationComposition = createNodeNotificationServices(
    withConfigCommit(withTaskWorkflowSettings(baseSettingsConfig, taskWorkflows), (config) =>
      autopilot ? autopilot.configCommitted(config) : Effect.void,
    ),
    eventBus,
  );
  const { settingsConfig } = notificationComposition;
  const setup = createNodeWorkspaceProviderSetup(
    { ...defaultPorts, settingsConfig },
    input,
    (repoPath) => observeWorkflowWorkspace(repoPath),
  );
  const { workspaceSettingsService, workspaceProviderSetup, workspaceAdmissionService } = setup;
  const assets = createNodeTaskAssetServices({
    configDir,
    assertWorkspaceAdmitted: workspaceAdmissionService.assertTaskStoreAccess,
    assertOwnershipReadAdmitted: workspaceAdmissionService.assertTaskStoreOwnershipReadAccess,
    configuredTaskStore,
    isWorkspaceBlocked: workspaceAdmissionService.isWorkspaceBlocked,
    onBackgroundFailure,
    processEnv: startupEnv,
    taskWorkflows,
    workspaceSettingsService,
  });
  const { startupSweep, taskAssetReadService, taskAssetStagingService, taskStore } = assets;
  const workspaceSessions = createNodeWorkspaceSessionPersistence({
    taskStore,
    store: assets.workspaceSessionStore,
    settings: workspaceSettingsService,
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
  const { liveSessionAdapterRegistry, liveState: agentSessionLiveStateService } =
    createNodeAgentSessionLiveState({
      runtimeAdmission,
      observeNotificationInput: notificationComposition.acceptLive,
      observeApprovalInput: createWorkflowLiveObserver(
        () => taskSessions,
        messageDelivery.runBackground,
      ),
      messageQueues: messageDelivery,
      persistence: workspaceSessions.persistence,
      withProcessStartAdmission: workspaceAdmissionService.withProcessStartAdmission,
      store: assets.workspaceSessionStore,
      taskStore,
      settings: workspaceSettingsService,
      eventBus,
      lifecycleLogger,
    });
  // The Git panel and merge detection share one fetch of each remote.
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
  const terminalService = Effect.runSync(
    createTerminalService({
      withProcessStartAdmission: workspaceAdmissionService.withProcessStartAdmission,
      filesystem,
      git,
      taskWorktrees: taskWorktreeService,
      workspaceSessions: {
        settings: workspaceSettingsService,
        store: assets.workspaceSessionStore,
      },
      ptyPort: terminalPty,
      launchEnvironment: createTerminalLaunchEnvironment({ readEnv }),
    }),
  );
  const { browserService, ...callers } = createNodeBrowser({
    engine: browserEngine,
    automation: browserAutomation,
    configRoot: configDir.root,
    settings: workspaceSettingsService,
    git,
    tasks: taskStore,
    workspaceSessions: assets.workspaceSessionStore,
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
    activity: createWorkspaceActivityInspector({
      agentSessionLiveStateService,
      terminalService,
    }),
    admission: workspaceAdmissionService,
    gitPort: git,
    settingsConfig,
    storage: createNodeWorkspaceStorageRemoval({
      taskAssets: assets,
      azureDevOpsConnection,
      browserService,
    }),
    taskSessionLifecycleCoordinator,
    taskStore,
    workspaceSettingsService,
    worktreeFiles,
  });
  const taskSessions = createNodeTaskSessionServices({
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
      observeStatusChanges: (change) => autopilot?.observe(change),
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
    repositoryPolicy: workspaceSessions.persistence,
    pauseForStop: messageDelivery.pauseForStop,
    readSessionRootRefs: createLiveSessionRootRefsReader({
      store: assets.workspaceSessionStore,
      taskStore,
      settings: workspaceSettingsService,
    }),
    workflowLaunch: {
      messageDelivery,
      resolveParts: (parts) => resolveSessionMessageParts(parts, localAttachmentService),
      adapterRegistry: liveSessionAdapterRegistry,
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
    workspaceSessions: assets.workspaceSessionStore,
  });
  const autopilotService = createAutopilotService({
    settingsConfig,
    taskWorkflows,
    tasks: taskService,
    mutations: taskSyncService,
    workflowLaunch: taskSessions.workflowLaunchService,
    notifications: notificationService,
    publish: (event) => eventBus?.publish({ channel: "openducktor://run-event", payload: event }),
    onBackgroundFailure,
  });
  autopilot = autopilotService;
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
    store: assets.workspaceSessionStore,
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
    readEnv,
  });
  const workspaceFiles = workspaceChats.scopeFiles(createWorkspaceFilesService(filesystem, git));
  const launchControls = createNodeSessionLaunchControls(agentSessionCommandService, [
    taskSessions.workflowLaunchService,
    workspaceChats.workspaceSessionLaunchService,
  ]);
  const hostRouterLifecycle = createNodeHostRouterLifecycle({
    initializeAdmission: () =>
      workspaceAdmissionService
        .initialize()
        .pipe(
          Effect.andThen(
            initializeWorkflowObservation(workspaceSettingsService, agentSessionLiveStateService),
          ),
        ),
    shutdownWorkspaceImports: workspaceChats.workspaceSessionImports.shutdown,
    shutdownWorkspaceSessionPersistence: workspaceSessions.persistence.shutdown,
    shutdownMessageDeliveries: messageDelivery.shutdown,
    unsubscribeImportCatalogs: workspaceChats.unsubscribeImportCatalogs,
    notifications: notificationService,
    autopilot: autopilotService,
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
    startupSweep,
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
    ...createAutopilotCommandHandlers(autopilotService),
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
      repoStoreDiagnostics: taskStore,
      remoteFetch,
    }),
    ...createTerminalCommandHandlers(terminalService),
    ...createBrowserCommandHandlers(browserService),
    ...createRepoActionCommandHandlers(repoActionService),
    ...createWorkspaceSettingsCommandHandlers(workspaceSettingsService, hostRuntimeService),
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
