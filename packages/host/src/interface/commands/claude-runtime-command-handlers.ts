import {
  CLAUDE_RUNTIME_COMMAND_CONTRACTS,
  type ClaudeRuntimeCommandContract,
} from "@openducktor/contracts";
import { pathStartsWith } from "@openducktor/path-support";
import { Effect } from "effect";
import type { ClaudeAgentSdkService } from "../../application/runtimes/claude-agent-sdk-service";
import { requireLiveClaudeWorkspaceRuntime } from "../../application/runtimes/claude-workspace-runtime";
import type { WorkspaceSettingsService } from "../../application/workspaces/workspace-settings-model";
import { type HostError, HostValidationError } from "../../effect/host-errors";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { HostCommandHandler, HostCommandHandlers } from "../router/host-command-router";
import { requireRecord } from "./command-inputs";

type ClaudeRuntimeCommandDependencies = {
  settingsConfig: Pick<
    SettingsConfigPort,
    | "canonicalizePath"
    | "defaultRepoWorktreeBasePath"
    | "defaultWorktreeBasePath"
    | "resolveConfiguredPath"
  >;
  workspaceSettingsService: Pick<WorkspaceSettingsService, "getRepoConfigByRepoPath">;
};

const requireClaudeWorkspaceWorkingDirectory = (
  runtimeRegistry: RuntimeRegistryPort,
  dependencies: ClaudeRuntimeCommandDependencies,
  input: { repoPath: string; runtimeKind: string; workingDirectory: string },
) =>
  Effect.gen(function* () {
    yield* requireLiveClaudeWorkspaceRuntime(runtimeRegistry, input);
    const canonicalRepoPath = yield* dependencies.settingsConfig.canonicalizePath(input.repoPath);
    const canonicalWorkingDirectory = yield* dependencies.settingsConfig.canonicalizePath(
      input.workingDirectory,
    );
    if (pathStartsWith(canonicalWorkingDirectory, canonicalRepoPath)) {
      return;
    }

    const repoConfig =
      yield* dependencies.workspaceSettingsService.getRepoConfigByRepoPath(canonicalRepoPath);
    const worktreeBasePath =
      repoConfig.worktreeBasePath !== undefined
        ? dependencies.settingsConfig.resolveConfiguredPath(repoConfig.worktreeBasePath)
        : dependencies.settingsConfig.defaultWorktreeBasePath(repoConfig.workspaceId);
    const canonicalWorktreeBasePath =
      yield* dependencies.settingsConfig.canonicalizePath(worktreeBasePath);
    if (pathStartsWith(canonicalWorkingDirectory, canonicalWorktreeBasePath)) {
      return;
    }

    const canonicalLegacyWorktreeBasePath = yield* dependencies.settingsConfig.canonicalizePath(
      dependencies.settingsConfig.defaultRepoWorktreeBasePath(canonicalRepoPath),
    );
    if (pathStartsWith(canonicalWorkingDirectory, canonicalLegacyWorktreeBasePath)) {
      return;
    }

    return yield* Effect.fail(
      new HostValidationError({
        field: "workingDirectory",
        message: `Working directory '${input.workingDirectory}' is outside the selected workspace.`,
        details: {
          repoPath: input.repoPath,
          workingDirectory: input.workingDirectory,
        },
      }),
    );
  });

const toClaudeCommandValidationError = (command: string, cause: unknown): HostValidationError => {
  if (cause instanceof HostValidationError) {
    return cause;
  }
  return new HostValidationError({
    message: cause instanceof Error ? cause.message : String(cause),
    field: "args",
    cause,
    details: { command },
  });
};

const createClaudeCommandHandler = <Input, Response>(
  service: ClaudeAgentSdkService,
  contract: ClaudeRuntimeCommandContract<Input, Response>,
  invoke: (service: ClaudeAgentSdkService, input: Input) => Effect.Effect<unknown, HostError>,
): HostCommandHandler => {
  const command = contract.command;
  return (args) =>
    Effect.gen(function* () {
      const input = yield* Effect.try({
        try: () => {
          const envelope = requireRecord(args, `${command} args`);
          return contract.inputSchema.parse(requireRecord(envelope.input, `${command} input`));
        },
        catch: (cause) => toClaudeCommandValidationError(command, cause),
      });
      const output = yield* invoke(service, input);
      return yield* Effect.try({
        try: () => contract.responseSchema.parse(output),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            field: "result",
            cause,
            details: { command },
          }),
      });
    });
};

export const createClaudeRuntimeCommandHandlers = (
  service: ClaudeAgentSdkService,
  runtimeRegistry: RuntimeRegistryPort,
  dependencies: ClaudeRuntimeCommandDependencies,
): HostCommandHandlers => ({
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.listModels.command]: createClaudeCommandHandler(
    service,
    CLAUDE_RUNTIME_COMMAND_CONTRACTS.listModels,
    (runtimeService, input) => runtimeService.listAvailableModels(input),
  ),
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.listSlashCommands.command]: createClaudeCommandHandler(
    service,
    CLAUDE_RUNTIME_COMMAND_CONTRACTS.listSlashCommands,
    (runtimeService, input) =>
      requireClaudeWorkspaceWorkingDirectory(runtimeRegistry, dependencies, input).pipe(
        Effect.flatMap(() => runtimeService.listAvailableSlashCommands(input)),
      ),
  ),
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.listSkills.command]: createClaudeCommandHandler(
    service,
    CLAUDE_RUNTIME_COMMAND_CONTRACTS.listSkills,
    (runtimeService, input) =>
      requireClaudeWorkspaceWorkingDirectory(runtimeRegistry, dependencies, input).pipe(
        Effect.flatMap(() => runtimeService.listAvailableSkills(input)),
      ),
  ),
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.listSubagents.command]: createClaudeCommandHandler(
    service,
    CLAUDE_RUNTIME_COMMAND_CONTRACTS.listSubagents,
    (runtimeService, input) =>
      requireClaudeWorkspaceWorkingDirectory(runtimeRegistry, dependencies, input).pipe(
        Effect.flatMap(() => runtimeService.listAvailableSubagents(input)),
      ),
  ),
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.searchFiles.command]: createClaudeCommandHandler(
    service,
    CLAUDE_RUNTIME_COMMAND_CONTRACTS.searchFiles,
    (runtimeService, input) =>
      requireClaudeWorkspaceWorkingDirectory(runtimeRegistry, dependencies, input).pipe(
        Effect.flatMap(() => runtimeService.searchFiles(input)),
      ),
  ),
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.loadSessionHistory.command]: createClaudeCommandHandler(
    service,
    CLAUDE_RUNTIME_COMMAND_CONTRACTS.loadSessionHistory,
    (runtimeService, input) =>
      requireClaudeWorkspaceWorkingDirectory(runtimeRegistry, dependencies, input).pipe(
        Effect.flatMap(() =>
          runtimeService.loadSessionHistory({
            repoPath: input.repoPath,
            runtimeKind: input.runtimeKind,
            workingDirectory: input.workingDirectory,
            externalSessionId: input.externalSessionId,
            runtimePolicy: input.runtimePolicy,
            ...(input.sessionScope ? { sessionScope: input.sessionScope } : {}),
            ...(input.model ? { model: input.model } : {}),
            ...(input.systemPromptContext
              ? { systemPromptContext: input.systemPromptContext }
              : {}),
            ...(input.limit !== undefined ? { limit: input.limit } : {}),
          }),
        ),
      ),
  ),
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.loadSessionTodos.command]: createClaudeCommandHandler(
    service,
    CLAUDE_RUNTIME_COMMAND_CONTRACTS.loadSessionTodos,
    (runtimeService, input) => {
      const todosInput = {
        repoPath: input.repoPath,
        runtimeKind: input.runtimeKind,
        workingDirectory: input.workingDirectory,
        externalSessionId: input.externalSessionId,
        runtimePolicy: input.runtimePolicy,
        ...(input.model ? { model: input.model } : {}),
      };
      return requireClaudeWorkspaceWorkingDirectory(runtimeRegistry, dependencies, input).pipe(
        Effect.flatMap(() =>
          runtimeService.loadSessionTodos(
            input.sessionScope ? { ...todosInput, sessionScope: input.sessionScope } : todosInput,
          ),
        ),
      );
    },
  ),
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.loadSessionDiff.command]: createClaudeCommandHandler(
    service,
    CLAUDE_RUNTIME_COMMAND_CONTRACTS.loadSessionDiff,
    (runtimeService, input) =>
      runtimeService.loadSessionDiff({
        repoPath: input.repoPath,
        runtimeKind: input.runtimeKind,
        workingDirectory: input.workingDirectory,
        externalSessionId: input.externalSessionId,
        ...(input.runtimeHistoryAnchor ? { runtimeHistoryAnchor: input.runtimeHistoryAnchor } : {}),
      }),
  ),
  [CLAUDE_RUNTIME_COMMAND_CONTRACTS.fileStatus.command]: createClaudeCommandHandler(
    service,
    CLAUDE_RUNTIME_COMMAND_CONTRACTS.fileStatus,
    (runtimeService, input) => runtimeService.loadFileStatus(input),
  ),
});
