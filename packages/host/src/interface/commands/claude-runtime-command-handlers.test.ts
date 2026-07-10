import { describe, expect, mock, test } from "bun:test";
import type {
  AgentModelCatalog,
  ListAgentModelsInput,
  SearchAgentFilesInput,
} from "@openducktor/core";
import { Effect } from "effect";
import type { ClaudeAgentSdkService } from "../../application/runtimes/claude-agent-sdk-service";
import {
  type CreateHostCommandRouterInput,
  createEffectHostCommandRouter,
  toPromiseHostCommandRouter,
} from "../router/host-command-router";
import { createClaudeRuntimeCommandHandlers } from "./claude-runtime-command-handlers";

const createHostCommandRouter = (input: CreateHostCommandRouterInput) =>
  toPromiseHostCommandRouter(createEffectHostCommandRouter(input));

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
      handlers: createClaudeRuntimeCommandHandlers(
        new ServiceWithReceiver() as unknown as ClaudeAgentSdkService,
      ),
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
      handlers: createClaudeRuntimeCommandHandlers(service),
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
      handlers: createClaudeRuntimeCommandHandlers(service),
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
});
