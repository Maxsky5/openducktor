import { describe, expect, mock, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentSessionSummary } from "@openducktor/core";
import { createAgentRuntimeServices } from "./agent-runtime-services";

describe("agent runtime services", () => {
  test("exposes the shipped runtime definitions through the engine boundary", () => {
    const { agentEngine } = createAgentRuntimeServices();

    expect(agentEngine.listRuntimeDefinitions().map((runtime) => runtime.kind)).toEqual([
      "opencode",
      "codex",
    ]);
  });

  test("rejects unsupported runtime kinds at the service boundary", async () => {
    const { runtimeCatalogOperations } = createAgentRuntimeServices();

    await expect(
      runtimeCatalogOperations.loadRepoRuntimeCatalog({
        repoPath: "/repo",
        runtimeKind: "test-runtime" as RuntimeKind,
      }),
    ).rejects.toThrow("Unsupported agent runtime 'test-runtime'.");
  });

  test("returns adapter session summaries without repairing runtime identity", async () => {
    const originalStartSession = OpencodeSdkAdapter.prototype.startSession;
    const adapterSummary: AgentSessionSummary = {
      externalSessionId: "external-started",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktree",
      role: "build",
      startedAt: "2026-02-22T09:00:00.000Z",
      status: "running" as const,
    };

    OpencodeSdkAdapter.prototype.startSession = mock(async () => adapterSummary);

    try {
      const { agentEngine } = createAgentRuntimeServices();

      await expect(
        agentEngine.startSession({
          repoPath: "/repo",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
          taskId: "task-1",
          role: "build",
          systemPrompt: "Prompt",
        }),
      ).resolves.toBe(adapterSummary);
    } finally {
      OpencodeSdkAdapter.prototype.startSession = originalStartSession;
    }
  });

  test("keeps runtime engine methods bound when passed as callbacks", async () => {
    const originalListAvailableModels = OpencodeSdkAdapter.prototype.listAvailableModels;
    const originalLoadSessionTodos = OpencodeSdkAdapter.prototype.loadSessionTodos;
    const originalListAgentSessionRuntimeSnapshots =
      OpencodeSdkAdapter.prototype.listSessionRuntimeSnapshots;
    const listAvailableModels = mock(async () => ({
      models: [],
      defaultModelsByProvider: {},
    }));
    const loadSessionTodos = mock(async () => []);
    const listSessionRuntimeSnapshots = mock(async () => []);

    try {
      OpencodeSdkAdapter.prototype.listAvailableModels = listAvailableModels;
      OpencodeSdkAdapter.prototype.loadSessionTodos = loadSessionTodos;
      OpencodeSdkAdapter.prototype.listSessionRuntimeSnapshots = listSessionRuntimeSnapshots;

      const { agentEngine } = createAgentRuntimeServices();
      const {
        listAvailableModels: readModels,
        loadSessionTodos: readTodos,
        listSessionRuntimeSnapshots: readSessionRuntimeSnapshots,
      } = agentEngine;

      await readModels({
        runtimeKind: "opencode",
        repoPath: "/repo",
      });

      await readTodos({
        runtimeKind: "opencode",
        repoPath: "/repo",
        workingDirectory: "/tmp/repo",
        externalSessionId: "external-1",
      });

      await readSessionRuntimeSnapshots({
        runtimeKind: "opencode",
        repoPath: "/repo",
        directories: ["/tmp/repo"],
      });

      expect(listAvailableModels).toHaveBeenCalledTimes(1);
      expect(loadSessionTodos).toHaveBeenCalledTimes(1);
      expect(listSessionRuntimeSnapshots).toHaveBeenCalledTimes(1);
    } finally {
      OpencodeSdkAdapter.prototype.listAvailableModels = originalListAvailableModels;
      OpencodeSdkAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
      OpencodeSdkAdapter.prototype.listSessionRuntimeSnapshots =
        originalListAgentSessionRuntimeSnapshots;
    }
  });

  test("routes event subscriptions through the explicit durable session ref", async () => {
    const originalSubscribeEvents = OpencodeSdkAdapter.prototype.subscribeEvents;
    const subscribedSessionRefs: unknown[] = [];

    OpencodeSdkAdapter.prototype.subscribeEvents = async (sessionRef) => {
      subscribedSessionRefs.push(sessionRef);
      return () => {};
    };

    const { agentEngine } = createAgentRuntimeServices();

    try {
      const sessionRef = {
        externalSessionId: "external-pending",
        repoPath: "/repo",
        workingDirectory: "/repo/worktree",
        runtimeKind: "opencode",
      } as const;

      const unsubscribe = await agentEngine.subscribeEvents(sessionRef, () => {});
      expect(subscribedSessionRefs).toEqual([sessionRef]);

      unsubscribe();
    } finally {
      OpencodeSdkAdapter.prototype.subscribeEvents = originalSubscribeEvents;
    }
  });
});
