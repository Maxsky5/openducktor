import { describe, expect, mock, test } from "bun:test";
import { RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import type {
  AgentModelCatalog,
  AgentSkillCatalog,
  AgentSlashCommandCatalog,
  AgentSubagentCatalog,
  ListAgentModelsInput,
  SearchAgentFilesInput,
} from "@openducktor/core";
import { Effect } from "effect";
import { createRuntimeRegistry } from "../../adapters/runtimes/runtime-registry";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";
import {
  type CreateHostCommandRouterInput,
  createEffectHostCommandRouter,
  toPromiseHostCommandRouter,
} from "../router/host-command-router";
import { createClaudeRuntimeCommandHandlers } from "./claude-runtime-command-handlers";

const createHostCommandRouter = (input: CreateHostCommandRouterInput) =>
  toPromiseHostCommandRouter(createEffectHostCommandRouter(input));

type CatalogOperation =
  | {
      command: "claude_runtime_list_slash_commands";
      method: "listAvailableSlashCommands";
      result: AgentSlashCommandCatalog;
    }
  | {
      command: "claude_runtime_list_skills";
      method: "listAvailableSkills";
      result: AgentSkillCatalog;
    }
  | {
      command: "claude_runtime_list_subagents";
      method: "listAvailableSubagents";
      result: AgentSubagentCatalog;
    };

const createLiveClaudeRuntimeRegistry = () =>
  createRuntimeRegistry({
    runtimes: [
      {
        kind: "claude",
        runtimeId: "runtime-claude",
        repoPath: "/repo",
        taskId: null,
        role: "workspace",
        workingDirectory: "/repo",
        runtimeRoute: { type: "host_service", identity: "runtime-claude" },
        startedAt: "2026-07-18T10:00:00.000Z",
        descriptor: RUNTIME_DESCRIPTORS_BY_KIND.claude,
      },
    ],
  });

const claudeCommandDependencies: Parameters<typeof createClaudeRuntimeCommandHandlers>[2] = {
  settingsConfig: {
    canonicalizePath: (path) => Effect.succeed(path),
    defaultRepoWorktreeBasePath: () => "/legacy-worktrees/repo",
    defaultWorktreeBasePath: () => "/worktrees/repo",
    resolveConfiguredPath: (path) => path,
  },
  workspaceSettingsService: {
    getRepoConfigByRepoPath: () =>
      Effect.succeed({
        workspaceId: "repo",
        workspaceName: "Repo",
        repoPath: "/repo",
        defaultRuntimeKind: "claude",
        branchPrefix: "odt/",
        defaultTargetBranch: { remote: "origin", branch: "main" },
        git: {},
        hooks: { preStart: [], postComplete: [] },
        devServers: [],
        promptOverrides: {},
        worktreeCopyPaths: [],
        agentDefaults: {},
        agentStudioState: { openTaskIds: [] },
        worktreeBasePath: "/worktrees/repo",
      }),
  },
};

type ClaudeCommandService = Parameters<typeof createClaudeRuntimeCommandHandlers>[0];

const createClaudeCommandService = <Overrides extends Partial<ClaudeCommandService>>(
  overrides: Overrides,
): ClaudeCommandService => ({
  listAvailableModels: () => Effect.die("listAvailableModels is not configured for this test"),
  listAvailableSkills: () => Effect.die("listAvailableSkills is not configured for this test"),
  listAvailableSlashCommands: () =>
    Effect.die("listAvailableSlashCommands is not configured for this test"),
  listAvailableSubagents: () =>
    Effect.die("listAvailableSubagents is not configured for this test"),
  loadFileStatus: () => Effect.die("loadFileStatus is not configured for this test"),
  loadSessionDiff: () => Effect.die("loadSessionDiff is not configured for this test"),
  loadSessionHistory: () => Effect.die("loadSessionHistory is not configured for this test"),
  loadSessionTodos: () => Effect.die("loadSessionTodos is not configured for this test"),
  searchFiles: () => Effect.die("searchFiles is not configured for this test"),
  ...overrides,
});

const createHandlers = (
  service: ClaudeCommandService,
  runtimeRegistry: RuntimeRegistryPort = createRuntimeRegistry(),
) => createClaudeRuntimeCommandHandlers(service, runtimeRegistry, claudeCommandDependencies);

describe("createClaudeRuntimeCommandHandlers", () => {
  test("preserves the Claude service receiver when invoking class-backed methods", async () => {
    class ServiceWithReceiver {
      readonly catalog: AgentModelCatalog = {
        models: [],
        defaultModelsByProvider: {},
      };

      listAvailableModels(_input: ListAgentModelsInput) {
        return Effect.succeed(this.catalog);
      }

      listAvailableSkills() {
        return Effect.die("listAvailableSkills is not configured for this test");
      }

      listAvailableSlashCommands() {
        return Effect.die("listAvailableSlashCommands is not configured for this test");
      }

      listAvailableSubagents() {
        return Effect.die("listAvailableSubagents is not configured for this test");
      }

      loadFileStatus() {
        return Effect.die("loadFileStatus is not configured for this test");
      }

      loadSessionDiff() {
        return Effect.die("loadSessionDiff is not configured for this test");
      }

      loadSessionHistory() {
        return Effect.die("loadSessionHistory is not configured for this test");
      }

      loadSessionTodos() {
        return Effect.die("loadSessionTodos is not configured for this test");
      }

      searchFiles() {
        return Effect.die("searchFiles is not configured for this test");
      }
    }

    const router = createHostCommandRouter({
      handlers: createHandlers(new ServiceWithReceiver(), createLiveClaudeRuntimeRegistry()),
    });

    await expect(
      router.invoke("claude_runtime_list_models", {
        input: {
          repoPath: "/repo",
          runtimeKind: "claude",
        },
      }),
    ).resolves.toEqual({
      models: [],
      defaultModelsByProvider: {},
    });
  });

  test("requires a matching live Claude workspace runtime before loading models", async () => {
    const listAvailableModels = mock((_input: ListAgentModelsInput) =>
      Effect.succeed({
        models: [],
        defaultModelsByProvider: {},
      }),
    );
    const service = createClaudeCommandService({ listAvailableModels });
    const router = createHostCommandRouter({
      handlers: createHandlers(service, createLiveClaudeRuntimeRegistry()),
    });

    await expect(
      router.invoke("claude_runtime_list_models", {
        input: {
          repoPath: "/private",
          runtimeKind: "claude",
        },
      }),
    ).rejects.toMatchObject({
      _tag: "HostValidationError",
      field: "runtimeKind",
    });

    expect(listAvailableModels).not.toHaveBeenCalled();
  });

  test("allows empty file search queries for initial autocomplete", async () => {
    const searchFiles = mock((_input: SearchAgentFilesInput) => Effect.succeed([]));
    const service = createClaudeCommandService({ searchFiles });
    const router = createHostCommandRouter({
      handlers: createHandlers(service, createLiveClaudeRuntimeRegistry()),
    });

    await expect(
      router.invoke("claude_runtime_search_files", {
        input: {
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo",
          query: "",
        },
      }),
    ).resolves.toEqual([]);

    expect(searchFiles).toHaveBeenCalledWith({
      repoPath: "/repo",
      runtimeKind: "claude",
      workingDirectory: "/repo",
      query: "",
    });
  });

  test("requires a live Claude workspace runtime before searching files", async () => {
    const searchFiles = mock((_input: SearchAgentFilesInput) => Effect.succeed([]));
    const service = createClaudeCommandService({ searchFiles });
    const router = createHostCommandRouter({
      handlers: createHandlers(service),
    });

    await expect(
      router.invoke("claude_runtime_search_files", {
        input: {
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo",
          query: "auth",
        },
      }),
    ).rejects.toMatchObject({
      _tag: "HostValidationError",
      field: "runtimeKind",
    });

    expect(searchFiles).not.toHaveBeenCalled();
  });

  test("requires a live workspace and validated directory before loading Claude catalogs", async () => {
    const catalogOperations: CatalogOperation[] = [
      {
        command: "claude_runtime_list_slash_commands",
        method: "listAvailableSlashCommands",
        result: { commands: [] },
      },
      {
        command: "claude_runtime_list_skills",
        method: "listAvailableSkills",
        result: { skills: [] },
      },
      {
        command: "claude_runtime_list_subagents",
        method: "listAvailableSubagents",
        result: { subagents: [] },
      },
    ];

    for (const operation of catalogOperations) {
      const loadCatalog = mock(() => Effect.succeed(operation.result));
      const service = createClaudeCommandService({
        [operation.method]: loadCatalog,
      });
      const input = {
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/private",
      };

      const routerWithoutRuntime = createHostCommandRouter({
        handlers: createHandlers(service),
      });
      await expect(routerWithoutRuntime.invoke(operation.command, { input })).rejects.toMatchObject(
        {
          _tag: "HostValidationError",
          field: "runtimeKind",
        },
      );

      const routerWithRuntime = createHostCommandRouter({
        handlers: createHandlers(service, createLiveClaudeRuntimeRegistry()),
      });
      await expect(routerWithRuntime.invoke(operation.command, { input })).rejects.toMatchObject({
        _tag: "HostValidationError",
        field: "workingDirectory",
      });
      expect(loadCatalog).not.toHaveBeenCalled();
    }
  });

  test("loads Claude catalogs from the managed task worktree root", async () => {
    const catalogOperations: CatalogOperation[] = [
      {
        command: "claude_runtime_list_slash_commands",
        method: "listAvailableSlashCommands",
        result: { commands: [] },
      },
      {
        command: "claude_runtime_list_skills",
        method: "listAvailableSkills",
        result: { skills: [] },
      },
      {
        command: "claude_runtime_list_subagents",
        method: "listAvailableSubagents",
        result: { subagents: [] },
      },
    ];

    for (const operation of catalogOperations) {
      const loadCatalog = mock(() => Effect.succeed(operation.result));
      const service = createClaudeCommandService({
        [operation.method]: loadCatalog,
      });
      const router = createHostCommandRouter({
        handlers: createHandlers(service, createLiveClaudeRuntimeRegistry()),
      });
      const input = {
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/worktrees/repo/task-1",
      };

      await expect(router.invoke(operation.command, { input })).resolves.toEqual(operation.result);
      expect(loadCatalog).toHaveBeenCalledWith(input);
    }
  });

  test("allows file search in the managed task worktree root", async () => {
    const searchFiles = mock((_input: SearchAgentFilesInput) => Effect.succeed([]));
    const service = createClaudeCommandService({ searchFiles });
    const router = createHostCommandRouter({
      handlers: createHandlers(service, createLiveClaudeRuntimeRegistry()),
    });

    await expect(
      router.invoke("claude_runtime_search_files", {
        input: {
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/worktrees/repo/task-1",
          query: "auth",
        },
      }),
    ).resolves.toEqual([]);

    expect(searchFiles).toHaveBeenCalledTimes(1);
  });

  test("rejects file search outside the selected workspace", async () => {
    const searchFiles = mock((_input: SearchAgentFilesInput) => Effect.succeed([]));
    const service = createClaudeCommandService({ searchFiles });
    const router = createHostCommandRouter({
      handlers: createHandlers(service, createLiveClaudeRuntimeRegistry()),
    });

    await expect(
      router.invoke("claude_runtime_search_files", {
        input: {
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/private",
          query: "secret",
        },
      }),
    ).rejects.toMatchObject({
      _tag: "HostValidationError",
      field: "workingDirectory",
    });

    expect(searchFiles).not.toHaveBeenCalled();
  });

  test("rejects service output that violates the selected command contract", async () => {
    const service = createClaudeCommandService({
      // @ts-expect-error -- The malformed service result must cross the typed test boundary.
      listAvailableModels: () => Effect.succeed({ unrelated: true }),
    });
    const router = createHostCommandRouter({
      handlers: createHandlers(service, createLiveClaudeRuntimeRegistry()),
    });

    await expect(
      router.invoke("claude_runtime_list_models", {
        input: {
          repoPath: "/repo",
          runtimeKind: "claude",
        },
      }),
    ).rejects.toMatchObject({
      _tag: "HostValidationError",
      field: "result",
    });
  });

  test("requires a live Claude workspace runtime before loading session history", async () => {
    const loadSessionHistory = mock(() => Effect.succeed([]));
    const service = createClaudeCommandService({ loadSessionHistory });
    const router = createHostCommandRouter({
      handlers: createHandlers(service),
    });

    await expect(
      router.invoke("claude_runtime_load_session_history", {
        input: {
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo",
          externalSessionId: "session-1",
          runtimePolicy: { kind: "claude" },
          model: {
            runtimeKind: "claude",
            providerId: "claude",
            modelId: "claude-sonnet-4-6",
            variant: "high",
          },
        },
      }),
    ).rejects.toMatchObject({
      _tag: "HostValidationError",
      field: "runtimeKind",
      message: "No live Claude workspace runtime found for repo '/repo'.",
    });
    expect(loadSessionHistory).not.toHaveBeenCalled();
  });

  test("loads session history after resolving the live Claude workspace runtime", async () => {
    const loadSessionHistory = mock(() => Effect.succeed([]));
    const service = createClaudeCommandService({ loadSessionHistory });
    const runtimeRegistry = createLiveClaudeRuntimeRegistry();
    const router = createHostCommandRouter({
      handlers: createHandlers(service, runtimeRegistry),
    });

    await expect(
      router.invoke("claude_runtime_load_session_history", {
        input: {
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/worktrees/repo/task-1",
          externalSessionId: "session-1",
          runtimePolicy: { kind: "claude" },
          model: {
            runtimeKind: "claude",
            providerId: "claude",
            modelId: "claude-sonnet-4-6",
            variant: "high",
          },
        },
      }),
    ).resolves.toEqual([]);
    expect(loadSessionHistory).toHaveBeenCalledWith({
      repoPath: "/repo",
      runtimeKind: "claude",
      workingDirectory: "/worktrees/repo/task-1",
      externalSessionId: "session-1",
      runtimePolicy: { kind: "claude" },
      model: {
        runtimeKind: "claude",
        providerId: "claude",
        modelId: "claude-sonnet-4-6",
        variant: "high",
      },
    });
  });

  test("requires a live Claude workspace runtime before loading session todos", async () => {
    const loadSessionTodos = mock(() => Effect.succeed([]));
    const service = createClaudeCommandService({ loadSessionTodos });
    const router = createHostCommandRouter({
      handlers: createHandlers(service),
    });

    await expect(
      router.invoke("claude_runtime_load_session_todos", {
        input: {
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo",
          externalSessionId: "session-1",
          runtimePolicy: { kind: "claude" },
        },
      }),
    ).rejects.toMatchObject({
      _tag: "HostValidationError",
      field: "runtimeKind",
      message: "No live Claude workspace runtime found for repo '/repo'.",
    });
    expect(loadSessionTodos).not.toHaveBeenCalled();
  });

  test("loads session todos after resolving the live Claude workspace runtime", async () => {
    const loadSessionTodos = mock(() => Effect.succeed([]));
    const service = createClaudeCommandService({ loadSessionTodos });
    const runtimeRegistry = createLiveClaudeRuntimeRegistry();
    const router = createHostCommandRouter({
      handlers: createHandlers(service, runtimeRegistry),
    });

    await expect(
      router.invoke("claude_runtime_load_session_todos", {
        input: {
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/worktrees/repo/task-1",
          externalSessionId: "session-1",
          runtimePolicy: { kind: "claude" },
        },
      }),
    ).resolves.toEqual([]);
    expect(loadSessionTodos).toHaveBeenCalledWith({
      repoPath: "/repo",
      runtimeKind: "claude",
      workingDirectory: "/worktrees/repo/task-1",
      externalSessionId: "session-1",
      runtimePolicy: { kind: "claude" },
    });
  });

  test("rejects cold history and todo reads outside the selected workspace", async () => {
    const readOperations = [
      {
        command: "claude_runtime_load_session_history",
        method: "loadSessionHistory",
      },
      {
        command: "claude_runtime_load_session_todos",
        method: "loadSessionTodos",
      },
    ] as const;

    for (const operation of readOperations) {
      const loadSessionData = mock(() => Effect.succeed([]));
      const service = createClaudeCommandService({
        [operation.method]: loadSessionData,
      });
      const router = createHostCommandRouter({
        handlers: createHandlers(service, createLiveClaudeRuntimeRegistry()),
      });

      await expect(
        router.invoke(operation.command, {
          input: {
            repoPath: "/repo",
            runtimeKind: "claude",
            workingDirectory: "/private",
            externalSessionId: "session-1",
            runtimePolicy: { kind: "claude" },
          },
        }),
      ).rejects.toMatchObject({
        _tag: "HostValidationError",
        field: "workingDirectory",
      });
      expect(loadSessionData).not.toHaveBeenCalled();
    }
  });
});
