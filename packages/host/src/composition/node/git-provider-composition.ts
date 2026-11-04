import { Effect } from "effect";
import { AzureDevOpsProviderAdapter } from "../../adapters/git-providers/azure-devops/provider-adapter";
import { createAzureDevOpsConnectionAdapter } from "../../adapters/git-providers/azure-devops/connection";
import { createAzureDevOpsCredentialIndex } from "../../adapters/git-providers/azure-devops/credential-index";
import { createAzureDevOpsProtectedStorage } from "../../adapters/git-providers/azure-devops/protected-storage";
import type { GitProviderFetch } from "../../adapters/git-providers/git-provider-fetch";
import { createGitlabConnectionAdapter } from "../../adapters/git-providers/gitlab/connection";
import { createGitlabHttp } from "../../adapters/git-providers/gitlab/http";
import { GitlabProviderAdapter } from "../../adapters/git-providers/gitlab/provider-adapter";
import { createGitlabSecretStore } from "../../adapters/git-providers/gitlab/secret-store";
import { createSqliteGitlabAccountStore } from "../../adapters/sqlite/sqlite-gitlab-account-store";
import type { SqliteHostDatabaseManager } from "../../adapters/sqlite/sqlite-task-repository-context";
import { resolveGitlabClientId } from "../../config/gitlab";
import type { GitlabConnectionPort } from "../../ports/gitlab-connection-port";
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

export type NodeGitlabComposition = {
  connection: GitlabConnectionPort;
  adapter: GitlabProviderAdapter;
};

type NodeGitProviderComposition = {
  resolver: GitProviderResolver;
  azureDevOpsConnection: AzureDevOpsConnectionPort;
  azureAreaPaths: AzureAreaPathsPort;
  gitlab: NodeGitlabComposition;
};

type CreateNodeGitProviderCompositionInput = {
  gitProviderFetch?: GitProviderFetch | undefined;
  hostDatabase: Pick<SqliteHostDatabaseManager, "withHostDatabase">;
  gitPort: GitPort;
  systemCommands: SystemCommandPort;
  toolDiscovery: ToolDiscoveryPort;
  configDir: string;
  processEnv: NodeJS.ProcessEnv;
  eventBus?: HostEventBusPort | undefined;
};

export const createNodeGitProviderComposition = ({
  gitProviderFetch = fetch,
  hostDatabase,
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
    fetchImplementation: gitProviderFetch,
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
    fetchImplementation: gitProviderFetch,
    gitPort,
  });
  const gitlabHttp = createGitlabHttp(gitProviderFetch);
  // Settings save, workspace removal, setup, and the provider adapter share this one connection.
  const gitlabConnection = createGitlabConnectionAdapter({
    http: gitlabHttp,
    accounts: createSqliteGitlabAccountStore(hostDatabase),
    secrets: createGitlabSecretStore({ configDir }),
    clientId: resolveGitlabClientId(processEnv),
  });
  const gitlab = new GitlabProviderAdapter({
    connection: gitlabConnection,
    http: gitlabHttp,
    gitPort,
  });
  return createGitProviderResolver([
    new GithubProviderAdapter({ gitPort, systemCommands, toolDiscovery }),
    azureDevOps,
    gitlab,
  ]).pipe(
    Effect.map((resolver) => ({
      resolver,
      azureDevOpsConnection,
      azureAreaPaths: azureDevOps.areaPaths(),
      gitlab: { connection: gitlabConnection, adapter: gitlab },
    })),
  );
};
