import { Effect } from "effect";
import { AzureDevOpsProviderAdapter } from "../../adapters/git-providers/azure-devops/provider-adapter";
import { createAzureDevOpsConnectionAdapter } from "../../adapters/git-providers/azure-devops/connection";
import { createAzureDevOpsCredentialIndex } from "../../adapters/git-providers/azure-devops/credential-index";
import { createAzureDevOpsProtectedStorage } from "../../adapters/git-providers/azure-devops/protected-storage";
import type { AzureDevOpsFetch } from "../../adapters/git-providers/azure-devops/rest-client";
import { GithubProviderAdapter } from "../../adapters/git-providers/github/provider-adapter";
import { resolveAzureDevOpsEntraClientId } from "../../config/azure-devops";
import {
  createGitProviderResolver,
  type GitProviderResolver,
} from "../../application/git/git-provider-resolver";
import type { GitPort } from "../../ports/git-port";
import type { AzureDevOpsConnectionPort } from "../../ports/azure-devops-connection-port";
import type { AzureAreaPathsPort } from "../../ports/azure-area-paths-port";
import type { GitProviderRegistrationError } from "../../ports/git-provider-errors";
import type { SystemCommandPort } from "../../ports/system-command-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import type { HostEventBusPort } from "../../events/host-event-bus";

type NodeGitProviderComposition = {
  resolver: GitProviderResolver;
  azureDevOpsConnection: AzureDevOpsConnectionPort;
  azureAreaPaths: AzureAreaPathsPort;
};

type CreateNodeGitProviderCompositionInput = {
  azureDevOpsFetch?: AzureDevOpsFetch | undefined;
  gitPort: GitPort;
  systemCommands: SystemCommandPort;
  toolDiscovery: ToolDiscoveryPort;
  configDir: string;
  processEnv: NodeJS.ProcessEnv;
  eventBus?: HostEventBusPort | undefined;
};

export const createNodeGitProviderComposition = ({
  azureDevOpsFetch,
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
    fetchImplementation: azureDevOpsFetch ?? fetch,
    clientId: resolveAzureDevOpsEntraClientId(processEnv),
    protectedStorage: createAzureDevOpsProtectedStorage({ configDir }),
    credentialIndex: createAzureDevOpsCredentialIndex({ configDir }),
    publishConnectionState: (payload) =>
      eventBus?.publish({
        channel: "openducktor://azure-devops-connection-updated",
        payload,
      }),
  });
  const azureDevOps = new AzureDevOpsProviderAdapter({
    connectionPort: azureDevOpsConnection,
    fetchImplementation: azureDevOpsFetch ?? fetch,
    gitPort,
  });
  return createGitProviderResolver([
    new GithubProviderAdapter({ gitPort, systemCommands, toolDiscovery }),
    azureDevOps,
  ]).pipe(
    Effect.map((resolver) => ({
      resolver,
      azureDevOpsConnection,
      azureAreaPaths: azureDevOps.areaPaths(),
    })),
  );
};
