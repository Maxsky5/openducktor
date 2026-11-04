import {
  GITLAB_PROVIDER_DESCRIPTOR,
  type GitProviderHealth,
  type GitlabConnectionStatusInput,
  type GitlabProblem,
  type GitlabRepository,
} from "@openducktor/contracts";
import { isGitlabRepository } from "@openducktor/core";
import { Effect } from "effect";
import { errorMessage } from "../../../effect/host-errors";
import type {
  GitProviderHealthPort,
  GitProviderRepositoryPort,
} from "../../../ports/git-provider-port";
import type { GitlabConnectionPort } from "../../../ports/gitlab-connection-port";
import { unavailableProviderHealth } from "../provider-health";
import type { GitProviderWorkspace } from "../../../ports/git-provider-workspace";

const PROVIDER_ID = GITLAB_PROVIDER_DESCRIPTOR.id;

/** Problems where GitLab does not accept the linked credential. */
const CREDENTIAL_PROBLEMS = new Set<GitlabProblem>([
  "account_missing",
  "token_expired",
  "access_revoked",
  "sign_in_required",
  "missing_scope",
]);

export const createGitlabHealthPort = ({
  connection,
  repositoryPort,
}: {
  connection: Pick<GitlabConnectionPort, "status">;
  repositoryPort: GitProviderRepositoryPort<GitlabRepository>;
}): GitProviderHealthPort => ({
  getStatus(repoConfig: GitProviderWorkspace) {
    return Effect.gen(function* () {
      const provider = repoConfig.git.provider;
      if (provider?.id !== PROVIDER_ID || !provider.enabled)
        return unhealthy("GitLab is not enabled for this repository.", { enabled: false });
      const repository = provider.repository;
      if (!repository || !isGitlabRepository(repository))
        return unhealthy("Enter the GitLab instance URL and project path.");
      const accountId = provider.settings?.accountId;
      if (!accountId)
        return unhealthy("Connect a GitLab account: sign in, add a token, or pick an account.");
      const statusInput: GitlabConnectionStatusInput = {
        instanceUrl: repository.instanceUrl,
        projectPath: repository.projectPath,
        accountId,
      };
      const consent = provider.settings?.httpConsentInstanceUrl;
      if (consent !== undefined) statusInput.httpConsentInstanceUrl = consent;
      // The status asks GitLab and the mapping reads the Git remotes, so they run together.
      const [statusResult, mapping] = yield* Effect.all(
        [
          Effect.result(connection.status(statusInput)),
          Effect.result(repositoryPort.getMapping(repoConfig)),
        ],
        { concurrency: 2 },
      );
      if (statusResult._tag === "Failure") return unhealthy(errorMessage(statusResult.failure));
      const status = statusResult.success;
      const account = status.account ? `@${status.account.username}` : null;
      if (status.status === "needs_attention")
        return unhealthy(status.message, {
          authenticated: !CREDENTIAL_PROBLEMS.has(status.problem),
          account,
        });
      if (mapping._tag === "Failure")
        return unhealthy(errorMessage(mapping.failure), {
          authenticated: true,
          account,
          repositoryMappingValid: false,
        });
      return {
        providerId: PROVIDER_ID,
        enabled: true,
        available: true,
        executablePath: null,
        version: null,
        authenticated: true,
        account,
        repositoryMappingValid: true,
      } satisfies GitProviderHealth;
    });
  },
});

const unhealthy = (
  reason: string,
  options?: Parameters<typeof unavailableProviderHealth>[2],
): GitProviderHealth => unavailableProviderHealth(PROVIDER_ID, reason, options);
