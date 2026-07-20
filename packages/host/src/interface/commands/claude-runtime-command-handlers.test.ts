import { describe, expect, mock, test } from "bun:test";
import { RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
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

const createHandlers = (
  service: ClaudeAgentSdkService,
  runtimeRegistry: RuntimeRegistryPort = createRuntimeRegistry(),
) => createClaudeRuntimeCommandHandlers(service, runtimeRegistry);

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
      handlers: createHandlers(service),
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
    const runtimeRegistry = createRuntimeRegistry({
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
    const router = createHostCommandRouter({
      handlers: createHandlers(service, runtimeRegistry),
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
    ).resolves.toEqual([]);
    expect(loadSessionHistory).toHaveBeenCalledWith({
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
    });
  });
});
