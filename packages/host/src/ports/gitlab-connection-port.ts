import type {
  GitlabAccount,
  GitlabAccountAddTokenInput,
  GitlabConnectionStatus,
  GitlabConnectionStatusInput,
  GitlabDeviceCode,
  GitlabRepository,
  GitlabSignInPollResult,
} from "@openducktor/contracts";
import type { Effect } from "effect";
import type { HostError } from "../effect/host-errors";
import type { GitProviderWorkspace } from "./git-provider-workspace";

/** The linked account and its request header for one repository. */
export type GitlabAuthorization = {
  repository: GitlabRepository;
  account: GitlabAccount;
  headerValue: string;
};

/** Saved GitLab accounts for each instance, their secrets, and their links to repositories. */
export type GitlabConnectionPort = {
  listAccounts(instanceUrl: string): Effect.Effect<GitlabAccount[], HostError>;
  /** Checks the token, then saves or updates the account of its GitLab user. */
  addToken(input: GitlabAccountAddTokenInput): Effect.Effect<GitlabAccount, HostError>;
  /** Starts a GitLab.com device sign-in. */
  startSignIn(): Effect.Effect<GitlabDeviceCode, HostError>;
  /** Makes at most one token request. Saves the account when the user approved the sign-in. */
  pollSignIn(attemptId: string): Effect.Effect<GitlabSignInPollResult, HostError>;
  /** Reads the account and the project. Expected GitLab failures become `needs_attention`. */
  status(input: GitlabConnectionStatusInput): Effect.Effect<GitlabConnectionStatus, HostError>;
  /** The request header of the account that the repository links. */
  authorization(repoConfig: GitProviderWorkspace): Effect.Effect<GitlabAuthorization, HostError>;
  /** Deletes each candidate account that no workspace links. Logs failures. */
  release(accountIds: readonly string[]): Effect.Effect<void>;
  /** Deletes every account that no workspace links. Logs failures. */
  sweep(): Effect.Effect<void>;
  /** The instance URLs of saved accounts and configured GitLab projects. */
  knownInstances(): Effect.Effect<string[], HostError>;
};
