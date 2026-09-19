import { Effect } from "effect";
import { AzureDevOpsProviderAdapter } from "../../adapters/git-providers/azure-devops/provider-adapter";
import { createAzureDevOpsConnectionAdapter } from "../../adapters/git-providers/azure-devops/connection";
import { createAzureDevOpsProtectedStorage } from "../../adapters/git-providers/azure-devops/protected-storage";
import { GithubProviderAdapter } from "../../adapters/git-providers/github/provider-adapter";
import { resolveAzureDevOpsEntraClientId } from "../../config/azure-devops";
import {
  createGitProviderResolver,
  type GitProviderResolver,
} from "../../application/git/git-provider-resolver";
import type { GitPort } from "../../ports/git-port";
import type { AzureDevOpsConnectionPort } from "../../ports/azure-devops-connection-port";
import type { GitProviderRegistrationError } from "../../ports/git-provider-errors";
import type { SystemCommandPort } from "../../ports/system-command-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import type { HostEventBusPort } from "../../events/host-event-bus";

type NodeGitProviderComposition = {
  resolver: GitProviderResolver;
  azureDevOpsConnection: AzureDevOpsConnectionPort;
};

type CreateNodeGitProviderCompositionInput = {
  gitPort: GitPort;
  systemCommands: SystemCommandPort;
  toolDiscovery: ToolDiscoveryPort;
  configDir: string;
  processEnv: NodeJS.ProcessEnv;
  eventBus?: HostEventBusPort | undefined;
};

export const createNodeGitProviderComposition = ({
  gitPort,
  systemCommands,
  toolDiscovery,
  configDir,
  processEnv,
  eventBus,
}: CreateNodeGitProviderCompositionInput): Effect.Effect<
  NodeGitProviderComposition,
  GitProviderRegistrationError
> => {
  const azureDevOpsConnection = createAzureDevOpsConnectionAdapter({
    clientId: resolveAzureDevOpsEntraClientId(processEnv),
    protectedStorage: createAzureDevOpsProtectedStorage({ configDir }),
    publishConnectionState: (payload) =>
      eventBus?.publish({
        channel: "openducktor://azure-devops-connection-updated",
        payload,
      }),
  });
  return createGitProviderResolver([
    new GithubProviderAdapter({ gitPort, systemCommands, toolDiscovery }),
    new AzureDevOpsProviderAdapter({
      connectionPort: azureDevOpsConnection,
      gitPort,
    }),
  ]).pipe(Effect.map((resolver) => ({ resolver, azureDevOpsConnection })));
};

export const createNodeGitProviderResolver = (input: CreateNodeGitProviderCompositionInput) =>
  createNodeGitProviderComposition(input).pipe(Effect.map(({ resolver }) => resolver));
