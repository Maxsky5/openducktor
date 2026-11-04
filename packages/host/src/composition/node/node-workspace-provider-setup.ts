import { linkedGitlabAccountId } from "@openducktor/core";
import { Effect } from "effect";
import { randomUUID } from "node:crypto";
import {
  createWorkspaceSettingsService,
  type WorkspaceSettingsService,
} from "../../application/workspaces/workspace-settings-service";
import { createWorkspaceAdmissionService } from "../../application/workspaces/workspace-admission-service";
import { createWorkspaceProviderSetupCommandHandlers } from "../../interface/commands/workspace-provider-setup-command-handlers";
import { detectWorkspaceProviders } from "../../adapters/git-providers/workspace-provider-detection";
import { GithubProviderAdapter } from "../../adapters/git-providers/github/provider-adapter";
import { createGithubCli } from "../../adapters/git-providers/github/cli";
import { AzureDevOpsProviderAdapter } from "../../adapters/git-providers/azure-devops/provider-adapter";
import { createWorkspaceProviderSetupCredentials } from "../../adapters/git-providers/azure-devops/setup-credentials";
import { createAzureDevOpsProtectedStorage } from "../../adapters/git-providers/azure-devops/protected-storage";
import { createAzureDevOpsCredentialIndex } from "../../adapters/git-providers/azure-devops/credential-index";
import { resolveAzureDevOpsEntraClientId } from "../../config/azure-devops";
import { createWorkspaceProviderSetupService } from "../../application/workspaces/workspace-provider-setup-service";
import type { NodeHostDefaultPorts } from "./node-host-default-ports";
import type { HostEventBusPort } from "../../events/host-event-bus";
import type { GitProviderFetch } from "../../adapters/git-providers/git-provider-fetch";
import type { GlobalConfig } from "@openducktor/contracts";
import type { NodeGitlabComposition } from "./git-provider-composition";
import type { TaskWorkflowResolver } from "../../ports/task-workflow-port";

export const createNodeWorkspaceProviderSetup = (
  ports: NodeHostDefaultPorts,
  input: {
    eventBus?: HostEventBusPort | undefined;
    gitProviderFetch?: GitProviderFetch | undefined;
    gitlab: NodeGitlabComposition;
  },
  onWorkspaceAdded: (repoPath: string) => void,
  taskWorkflows: TaskWorkflowResolver,
) => {
  const savedSettings = createWorkspaceSettingsService(ports.settingsConfig, taskWorkflows);
  const { gitlab } = input;
  const settings: WorkspaceSettingsService = {
    ...savedSettings,
    // A save can unlink a GitLab account: Disconnect, a provider change, or an instance change.
    // The release runs after the commit, so it deletes only accounts that no workspace links now.
    saveSettingsSnapshotWith: (prepared, commit) =>
      savedSettings
        .saveSettingsSnapshotWith(prepared, commit)
        .pipe(Effect.tap(() => gitlab.connection.release(gitlabAccountIds(prepared.current)))),
    addWorkspace: (input) =>
      savedSettings.addWorkspace({
        ...input,
        onRegistered: (workspace) => {
          input.onRegistered?.(workspace);
          onWorkspaceAdded(workspace.repoPath);
        },
      }),
  };
  const { eventBus } = input;
  const fetchImplementation = input.gitProviderFetch ?? fetch;
  const { git, configDir, startupEnv, systemCommands, toolDiscovery } = ports;
  const credentials = createWorkspaceProviderSetupCredentials({
    clientId: resolveAzureDevOpsEntraClientId(startupEnv),
    protectedStorage: createAzureDevOpsProtectedStorage({ configDir: configDir.root }),
    credentialIndex: createAzureDevOpsCredentialIndex({ configDir: configDir.root }),
    fetchImplementation,
    publishConnectionState: (event) => service.connectionUpdated(event),
  });
  const azure = new AzureDevOpsProviderAdapter({
    gitPort: git,
    connectionPort: credentials.connection,
    fetchImplementation,
  });
  const githubCli = createGithubCli({ systemCommands, toolDiscovery });
  const service = createWorkspaceProviderSetupService({
    git,
    newSetupId: randomUUID,
    detectRepositories: (repoPath) =>
      Effect.all([git.listRemoteEndpoints(repoPath), gitlab.connection.knownInstances()], {
        concurrency: 2,
      }).pipe(
        Effect.map(([endpoints, knownInstances]) =>
          detectWorkspaceProviders(endpoints, knownInstances),
        ),
      ),
    settings,
    credentials,
    azure,
    areas: azure.areaPaths(),
    github: new GithubProviderAdapter({ gitPort: git, systemCommands, toolDiscovery }),
    gitlab: gitlab.adapter,
    publish: (payload) =>
      eventBus?.publish({ channel: "openducktor://workspace-provider-setup-updated", payload }),
    inspectGithub: (repoPath, host) =>
      Effect.gen(function* () {
        const commandResult = yield* Effect.result(githubCli.resolve());
        if (commandResult._tag === "Failure")
          return {
            executablePath: null,
            version: null,
            authenticated: false,
            account: null,
            reason: commandResult.failure.message,
          };
        const command = commandResult.success;
        const version = yield* command.readVersion({ cwd: repoPath });
        const auth = yield* command.getAuth(host);
        return { executablePath: command.executablePath, version, ...auth };
      }),
  });
  return {
    workspaceSettingsService: settings,
    workspaceAdmissionService: createWorkspaceAdmissionService({
      workspaceSettingsService: settings,
    }),
    workspaceProviderSetup: service,
    handlers: createWorkspaceProviderSetupCommandHandlers(service),
  };
};

const gitlabAccountIds = (config: GlobalConfig): string[] =>
  Object.values(config.workspaces).flatMap((workspace) => {
    const accountId = linkedGitlabAccountId(workspace.git.provider);
    return accountId ? [accountId] : [];
  });
