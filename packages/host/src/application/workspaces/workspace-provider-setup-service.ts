import {
  repoConfigSchema,
  type RepoConfig,
  type HostEventPayload,
  type WorkspaceProviderSetupSelection,
  type WorkspaceProviderSetupRef,
  type WorkspaceProviderSetupSession,
  type WorkspaceProviderSetupCommit,
  type WorkspaceProviderSetupProgress,
  type WorkspaceProviderSetupStatus,
  type WorkspaceProviderSetupDetection,
  type WorkspaceProviderSetupGithub,
} from "@openducktor/contracts";
import {
  azureDevOpsConnectionConfigurationFingerprint,
  azureDevOpsRepositoryKey,
} from "@openducktor/core";
import { Effect } from "effect";
import { HostValidationError, type HostError } from "../../effect/host-errors";
import type { GitPort, GitPortError } from "../../ports/git-port";
import type { GitProviderPort } from "../../ports/git-provider-port";
import type { AzureAreaPathsPort } from "../../ports/azure-area-paths-port";
import type { WorkspaceProviderSetupCredentialsPort } from "../../ports/workspace-provider-setup-credentials-port";
import type { WorkspaceSettingsService } from "./workspace-settings-model";

type Session = WorkspaceProviderSetupSession & {
  selection: WorkspaceProviderSetupSelection;
  credentialConfig: RepoConfig | null;
  cleanupRequired: boolean;
  writes: number;
  progress: WorkspaceProviderSetupProgress;
  signInRevision: number | null;
  startingSignIn: boolean;
  readiness: { ready: boolean } | null;
};
/** Keeps completed sessions until acknowledgement so callers can recover a lost commit reply. */
export const createWorkspaceProviderSetupService = (input: {
  git: Pick<GitPort, "canonicalizePath" | "isGitRepository">;
  newSetupId: () => string;
  detectRepositories: (
    repoPath: string,
  ) => Effect.Effect<WorkspaceProviderSetupDetection, GitPortError>;
  settings: WorkspaceSettingsService;
  github: Pick<GitProviderPort, "health">;
  azure: Pick<GitProviderPort, "health">;
  areas: AzureAreaPathsPort;
  credentials: WorkspaceProviderSetupCredentialsPort;
  inspectGithub: (
    repoPath: string,
    host: string,
  ) => Effect.Effect<WorkspaceProviderSetupGithub, HostError>;
  publish: (payload: HostEventPayload<"openducktor://workspace-provider-setup-updated">) => void;
}) => {
  const sessions = new Map<string, Session>();
  const requireSession = (ref: WorkspaceProviderSetupRef, allowCleanup = false) =>
    Effect.gen(function* () {
      const session = sessions.get(ref.setupId);
      if (!session)
        return yield* fail("Workspace setup is no longer active. Choose the repository again.");
      if (session.revision !== ref.revision)
        return yield* fail("Workspace setup changed. Review the current configuration and retry.");
      if (session.writes)
        return yield* fail("A setup operation is running. Wait for its result before retrying.");
      if (session.cleanupRequired && !allowCleanup)
        return yield* fail(
          "Azure connection cleanup failed. Retry the configuration change or cancel setup.",
        );
      return session;
    });
  // Cleanup can run beside sign-in startup, so count both owners until they finish.
  const write = <A, E>(session: Session, action: Effect.Effect<A, E>) =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        session.writes += 1;
      }),
      () => action,
      () =>
        Effect.sync(() => {
          session.writes -= 1;
        }),
    );
  const read = <A, E>(
    ref: WorkspaceProviderSetupRef,
    action: (session: Session) => Effect.Effect<A, E>,
  ) =>
    Effect.gen(function* () {
      const session = yield* requireSession(ref);
      const result = yield* action(session);
      yield* requireSession(ref);
      return result;
    });
  const release = (session: Session) =>
    Effect.gen(function* () {
      session.readiness = null;
      session.signInRevision = null;
      session.cleanupRequired = true;
      if (session.credentialConfig) yield* input.credentials.release(session.credentialConfig);
      session.credentialConfig = null;
      session.cleanupRequired = false;
    });
  const azureConfig = (session: Session) =>
    Effect.gen(function* () {
      const config = selectionConfig(session);
      const provider = config.git.provider;
      if (!provider?.enabled || !provider.repository || !("deployment" in provider.repository))
        return yield* fail("Complete and enable the Azure DevOps repository first.");
      session.credentialConfig = config;
      return { config, repository: provider.repository };
    });
  const statusFor = (session: Session) =>
    Effect.gen(function* () {
      // Each reply stays with its own check, so a late reply cannot replace current readiness.
      const check = { ready: false };
      session.readiness = check;
      const config = selectionConfig(session);
      const provider = config.git.provider;
      if (!provider)
        return { health: null, connection: null } satisfies WorkspaceProviderSetupStatus;
      const adapter = provider.id === "github" ? input.github : input.azure;
      const health = yield* adapter.health().getStatus(config);
      const repository = provider.repository;
      const connection =
        repository && "deployment" in repository
          ? yield* input.credentials.connection.getState(config, repository)
          : null;
      check.ready =
        health.available && health.authenticated && health.repositoryMappingValid === true;
      return { health, connection } satisfies WorkspaceProviderSetupStatus;
    });
  const requireReady = (session: Session) =>
    Effect.gen(function* () {
      if (session.selection.kind === "incomplete")
        return yield* fail(
          "Complete the provider fields, disable it with valid details, or skip setup.",
        );
      if (session.selection.kind === "configured" && session.selection.config.enabled) {
        if (!session.selection.config.repository)
          return yield* fail("Complete the repository details or skip setup.");
        if (session.readiness?.ready) return;
        const status = yield* statusFor(session);
        if (
          !status.health?.available ||
          !status.health.authenticated ||
          !status.health.repositoryMappingValid
        )
          return yield* fail(
            status.health?.reason ??
              "Check the provider connection and repository mapping before creation.",
          );
      }
    });
  return {
    begin(repoPath: string) {
      return Effect.gen(function* () {
        const path = yield* input.git.canonicalizePath(repoPath);
        if (!(yield* input.git.isGitRepository(path)))
          return yield* fail("Choose an existing local Git repository.");
        const resolution = yield* input.settings.resolveWorkspacePath(path);
        if (resolution.kind !== "new")
          return yield* fail(
            "This repository already has a workspace. Select or reopen it instead.",
          );
        const setupId = input.newSetupId();
        sessions.set(setupId, {
          setupId,
          repoPath: path,
          revision: 0,
          selection: { kind: "none" },
          credentialConfig: null,
          cleanupRequired: false,
          writes: 0,
          signInRevision: null,
          startingSignIn: false,
          readiness: null,
          progress: {
            workspace: null,
            registrationSaved: false,
            settingsSaved: false,
            credentialsSaved: false,
            phase: "validate",
            error: null,
          },
        });
        return { setupId, repoPath: path, revision: 0 };
      });
    },
    set(ref: WorkspaceProviderSetupRef, selection: WorkspaceProviderSetupSelection) {
      return Effect.gen(function* () {
        const session = yield* requireSession(ref, true);
        if (session.progress.phase === "complete")
          return yield* fail("Workspace creation already completed.");
        return yield* write(
          session,
          Effect.gen(function* () {
            session.readiness = null;
            const nextConfig = selectionConfig({ ...session, selection });
            const abandoned = credentialKey(session.credentialConfig) !== credentialKey(nextConfig);
            if (abandoned || session.cleanupRequired) {
              yield* release(session);
              session.progress.credentialsSaved = false;
            } else if (session.signInRevision !== null && session.credentialConfig) {
              session.signInRevision = null;
              const repository = session.credentialConfig.git.provider?.repository;
              if (repository && "deployment" in repository) {
                const state = yield* input.credentials.connection.getState(
                  session.credentialConfig,
                  repository,
                );
                if (state.status === "pending")
                  yield* input.credentials.connection.cancelCloudSignIn(state.deviceCode.attemptId);
              }
            }
            if (session.progress.workspace) {
              const workspace = yield* input.settings.updateRepoConfig(
                session.progress.workspace.workspaceId,
                { git: nextConfig.git },
              );
              session.progress.workspace = workspace;
            }
            session.selection = selection;
            session.revision += 1;
            session.progress.error = null;
            return {
              setupId: session.setupId,
              repoPath: session.repoPath,
              revision: session.revision,
            };
          }),
        );
      });
    },
    detect(ref: WorkspaceProviderSetupRef) {
      return read(ref, (session) => input.detectRepositories(session.repoPath));
    },
    status(ref: WorkspaceProviderSetupRef) {
      return read(ref, statusFor);
    },
    github(ref: WorkspaceProviderSetupRef, host: string) {
      return read(ref, (session) => input.inspectGithub(session.repoPath, host));
    },
    areas(ref: WorkspaceProviderSetupRef) {
      return read(ref, (session) =>
        Effect.gen(function* () {
          const { config } = yield* azureConfig(session);
          return yield* input.areas.list(config);
        }),
      );
    },
    signIn(ref: WorkspaceProviderSetupRef) {
      return Effect.gen(function* () {
        const session = yield* requireSession(ref);
        return yield* write(
          session,
          Effect.gen(function* () {
            session.readiness = null;
            const { config, repository } = yield* azureConfig(session);
            session.signInRevision = session.revision;
            session.startingSignIn = true;
            return yield* input.credentials.connection.startCloudSignIn(config, repository).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  session.startingSignIn = false;
                }),
              ),
            );
          }),
        );
      });
    },
    cancelSignIn(ref: WorkspaceProviderSetupRef, attemptId: string) {
      return Effect.gen(function* () {
        const session = yield* requireSession(ref);
        return yield* write(
          session,
          Effect.gen(function* () {
            session.readiness = null;
            const { config, repository } = yield* azureConfig(session);
            const state = yield* input.credentials.connection.getState(config, repository);
            if (state.status === "pending" && state.deviceCode.attemptId !== attemptId)
              return yield* fail("The sign-in attempt changed. Review the current connection.");
            session.signInRevision = null;
            if (state.status === "pending")
              yield* input.credentials.connection.cancelCloudSignIn(attemptId);
          }),
        );
      });
    },
    pat(ref: WorkspaceProviderSetupRef, pat: string) {
      return Effect.gen(function* () {
        const session = yield* requireSession(ref);
        return yield* write(
          session,
          Effect.gen(function* () {
            session.readiness = null;
            const { config, repository } = yield* azureConfig(session);
            const state = yield* input.credentials.connection.getState(config, repository);
            session.signInRevision = null;
            if (state.status === "pending")
              yield* input.credentials.connection.cancelCloudSignIn(state.deviceCode.attemptId);
            yield* input.credentials.connection.replacePat(config, repository, pat);
            return yield* input.credentials.connection.getState(config, repository);
          }),
        );
      });
    },
    disconnect(ref: WorkspaceProviderSetupRef) {
      return Effect.gen(function* () {
        const session = yield* requireSession(ref, true);
        return yield* write(session, release(session));
      });
    },
    commit(commit: WorkspaceProviderSetupCommit) {
      return Effect.gen(function* () {
        const session = yield* requireSession(commit);
        if (session.progress.phase === "complete") return { ...session.progress };
        return yield* write(
          session,
          Effect.gen(function* () {
            session.progress.error = null;
            const result = yield* Effect.result(
              Effect.gen(function* () {
                if (
                  session.progress.workspace &&
                  commit.workspaceId !== session.progress.workspace.workspaceId
                )
                  return yield* fail(
                    "The workspace already exists. Retry with its saved workspace ID.",
                  );
                session.progress.phase = "validate";
                yield* requireReady(session);
                const config = selectionConfig(session);
                session.progress.phase = "settings";
                if (!session.progress.registrationSaved) {
                  const workspace = yield* input.settings.addWorkspace({
                    ...commit,
                    repoPath: session.repoPath,
                    git: config.git,
                    onRegistered: (record) => {
                      session.progress.workspace = record;
                      session.progress.registrationSaved = true;
                      session.progress.settingsSaved = true;
                    },
                  });
                  session.progress.workspace = workspace;
                }
                session.progress.phase = "credentials";
                if (credentialKey(config) && !session.progress.credentialsSaved) {
                  const destination = yield* input.settings.getRepoConfig(
                    session.progress.workspace!.workspaceId,
                  );
                  yield* input.credentials.transfer(config, destination);
                }
                session.progress.credentialsSaved = true;
                if (session.credentialConfig)
                  yield* input.credentials.complete(session.credentialConfig);
                session.credentialConfig = null;
                session.signInRevision = null;
                session.progress.phase = "complete";
              }),
            );
            if (result._tag === "Failure")
              session.progress.error = `${result.failure.message} ${session.progress.registrationSaved ? "Workspace and settings are saved. Retry this setup to continue." : "No workspace was created. Correct the input and retry."}`;
            return { ...session.progress };
          }),
        );
      });
    },
    progress(setupId: string) {
      return Effect.gen(function* () {
        const session = sessions.get(setupId);
        if (!session) return yield* fail("Workspace setup was not found.");
        return {
          setupId,
          repoPath: session.repoPath,
          revision: session.revision,
          selection: session.selection,
          progress: { ...session.progress },
        };
      });
    },
    discard(setupId: string) {
      return Effect.gen(function* () {
        const session = sessions.get(setupId);
        if (!session) return;
        if (session.writes && !(session.startingSignIn && session.writes === 1))
          return yield* fail(
            "A setup operation is running. Wait for its result before cancelling.",
          );
        if (session.progress.phase !== "complete") yield* write(session, release(session));
        sessions.delete(setupId);
      });
    },
    connectionUpdated(payload: HostEventPayload<"openducktor://azure-devops-connection-updated">) {
      const session = sessions.get(payload.workspaceId);
      const config = session?.credentialConfig;
      const repository = config?.git.provider?.repository;
      if (
        !session ||
        payload.repoPath !== session.repoPath ||
        session.cleanupRequired ||
        session.signInRevision !== session.revision ||
        !repository ||
        !("deployment" in repository)
      )
        return;
      if (
        payload.configurationFingerprint !==
        azureDevOpsConnectionConfigurationFingerprint(session.setupId, session.repoPath, repository)
      )
        return;
      session.readiness = null;
      input.publish({
        setupId: session.setupId,
        repoPath: session.repoPath,
        revision: session.revision,
        configurationFingerprint: payload.configurationFingerprint,
        attemptId: payload.attemptId,
        state: payload.state,
      });
    },
    shutdown() {
      return Effect.gen(function* () {
        yield* input.credentials.connection.shutdown();
        yield* Effect.forEach([...sessions.values()], release, { discard: true });
        sessions.clear();
      });
    },
  };
};
export type WorkspaceProviderSetupService = ReturnType<typeof createWorkspaceProviderSetupService>;

function fail(message: string) {
  return new HostValidationError({ field: "workspaceProviderSetup", message });
}

function selectionConfig(session: Session): RepoConfig {
  return repoConfigSchema.parse({
    workspaceId: session.setupId,
    workspaceName: "Workspace setup",
    repoPath: session.repoPath,
    git: session.selection.kind === "configured" ? { provider: session.selection.config } : {},
  });
}

function credentialKey(config: RepoConfig | null): string | null {
  const provider = config?.git.provider;
  const repository = provider?.repository;
  if (!provider?.enabled || !repository || !("deployment" in repository)) return null;
  return azureDevOpsRepositoryKey(repository);
}
