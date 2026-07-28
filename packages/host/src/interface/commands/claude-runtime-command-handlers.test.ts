import { describe, expect, mock, test } from "bun:test";
import { type RepoConfig, RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import type {
  AgentModelCatalog,
  ListAgentModelsInput,
  SearchAgentFilesInput,
} from "@openducktor/core";
import { Effect } from "effect";
import { createRuntimeRegistry } from "../../adapters/runtimes/runtime-registry";
import type { ClaudeAgentSdkService } from "../../application/runtimes/claude-agent-sdk-service";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";
import {
  type CreateHostCommandRouterInput,
  createEffectHostCommandRouter,
  toPromiseHostCommandRouter,
} from "../router/host-command-router";
import { createClaudeRuntimeCommandHandlers } from "./claude-runtime-command-handlers";

const createHostCommandRouter = (input: CreateHostCommandRouterInput) =>
  toPromiseHostCommandRouter(createEffectHostCommandRouter(input));

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
        worktreeBasePath: "/worktrees/repo",
      } as RepoConfig),
  },
};

const createHandlers = (
  service: ClaudeAgentSdkService,
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
    }

    const router = createHostCommandRouter({
      handlers: createHandlers(new ServiceWithReceiver() as unknown as ClaudeAgentSdkService),
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

  test("allows empty file search queries for initial autocomplete", async () => {
    const searchFiles = mock((_input: SearchAgentFilesInput) => Effect.succeed([]));
    const service = { searchFiles } as unknown as ClaudeAgentSdkService;
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
    const service = { searchFiles } as unknown as ClaudeAgentSdkService;
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
    const catalogOperations = [
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
    ] as const;

    for (const operation of catalogOperations) {
      const loadCatalog = mock(() => Effect.succeed(operation.result));
      const service = {
        [operation.method]: loadCatalog,
      } as unknown as ClaudeAgentSdkService;
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
    const catalogOperations = [
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
    ] as const;

    for (const operation of catalogOperations) {
      const loadCatalog = mock(() => Effect.succeed(operation.result));
      const service = {
        [operation.method]: loadCatalog,
      } as unknown as ClaudeAgentSdkService;
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
    const service = { searchFiles } as unknown as ClaudeAgentSdkService;
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
    const service = { searchFiles } as unknown as ClaudeAgentSdkService;
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
    const service = {
      listAvailableModels: () => Effect.succeed({ unrelated: true }),
    } as unknown as ClaudeAgentSdkService;
    const router = createHostCommandRouter({
      handlers: createHandlers(service),
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
    const service = { loadSessionHistory } as unknown as ClaudeAgentSdkService;
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
    const service = { loadSessionHistory } as unknown as ClaudeAgentSdkService;
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
    const service = { loadSessionTodos } as unknown as ClaudeAgentSdkService;
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
    const service = { loadSessionTodos } as unknown as ClaudeAgentSdkService;
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
      const service = {
        [operation.method]: loadSessionData,
      } as unknown as ClaudeAgentSdkService;
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
