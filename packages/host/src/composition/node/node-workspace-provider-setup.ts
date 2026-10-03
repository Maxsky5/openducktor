import { Effect } from "effect";
import { randomUUID } from "node:crypto";
import { createWorkspaceSettingsService } from "../../application/workspaces/workspace-settings-service";
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
import type { AzureDevOpsFetch } from "../../adapters/git-providers/azure-devops/rest-client";

export const createNodeWorkspaceProviderSetup = (
  ports: NodeHostDefaultPorts,
  input: {
    eventBus?: HostEventBusPort | undefined;
    azureDevOpsFetch?: AzureDevOpsFetch | undefined;
  },
) => {
  const settings = createWorkspaceSettingsService(ports.settingsConfig);
  const { eventBus } = input;
  const fetchImplementation = input.azureDevOpsFetch ?? fetch;
  const { git, configDir, systemCommands, toolDiscovery, processEnvironment } = ports;
  const credentials = createWorkspaceProviderSetupCredentials({
    clientId: resolveAzureDevOpsEntraClientId(processEnvironment.environment),
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
      git.listRemoteEndpoints(repoPath).pipe(Effect.map(detectWorkspaceProviders)),
    settings,
    credentials,
    azure,
    areas: azure.areaPaths(),
    github: new GithubProviderAdapter({ gitPort: git, systemCommands, toolDiscovery }),
    publish: (payload) =>
      eventBus?.publish({ channel: "openducktor://workspace-provider-setup-updated", payload }),
    inspectGithub: (repoPath, host) =>
      Effect.gen(function* () {
        const commandResult = yield* Effect.either(githubCli.resolve());
        if (commandResult._tag === "Left")
          return {
            executablePath: null,
            version: null,
            authenticated: false,
            account: null,
            reason: commandResult.left.message,
          };
        const command = commandResult.right;
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
