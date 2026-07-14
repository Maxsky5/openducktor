import { describe, expect, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import {
  buildSession,
  createSessionActions,
  createSessionsRef,
  type SessionActionTestOverrides,
} from "./session-actions.test-helpers";

describe("agent-orchestrator/handlers/session-actions", () => {
  test("returns action handlers", () => {
    const actions = createSessionActions({ updateSession: () => null });

    expect(typeof actions.sendAgentMessage).toBe("function");
    expect(typeof actions.startAgentSession).toBe("function");
    expect(typeof actions.stopAgentSession).toBe("function");
  });

  test("uses live workspace refs for session start stale checks", async () => {
    const adapter = new OpencodeSdkAdapter();
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" as string | null };
    const actions = createSessionActions({
      adapter,
      currentWorkspaceRepoPathRef,
      updateSession: () => null,
    });

    currentWorkspaceRepoPathRef.current = "/tmp/other";

    await expect(
      actions.startAgentSession({
        taskId: "task-1",
        role: "build",
        startMode: "fresh",
        selectedModel: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5.4",
          variant: "high",
          profileId: "Hephaestus (Deep Agent)",
        },
      }),
    ).rejects.toThrow("Workspace changed while starting session.");
  });

  test("routes fork canonicalization and startup leases through injected dependencies", async () => {
    const adapter = new OpencodeSdkAdapter();
    const canonicalizedPaths: string[] = [];
    const preparedLeases: Array<[string, string, string]> = [];
    const completedLeaseIds: string[] = [];
    const sourceSession = buildSession({
      externalSessionId: "source-session",
      historyLoadState: "loaded",
      status: "stopped",
    });
    adapter.forkSession = async (input) => ({
      runtimeKind: "opencode",
      workingDirectory: input.workingDirectory,
      externalSessionId: "forked-session",
      role: "build",
      status: "idle",
      startedAt: "2026-02-22T08:20:00.000Z",
    });
    adapter.loadSessionHistory = async () => [];

    const injectedRuntimeDependencies: SessionActionTestOverrides = {
      canonicalizePath: async (path: string) => {
        canonicalizedPaths.push(path);
        return path;
      },
      prepareTaskSessionStartupLease: async (repoPath: string, taskId: string, role: string) => {
        preparedLeases.push([repoPath, taskId, role]);
        return "injected-lease";
      },
      completeTaskSessionStartupLease: async (
        _repoPath: string,
        _taskId: string,
        leaseId: string,
      ) => {
        completedLeaseIds.push(leaseId);
      },
      abortTaskSessionStartupLease: async () => {},
    };
    const actions = createSessionActions({
      ...injectedRuntimeDependencies,
      adapter,
      sessionsRef: createSessionsRef([sourceSession]),
    });

    await expect(
      actions.startAgentSession({
        taskId: "task-1",
        role: "build",
        startMode: "fork",
        selectedModel: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5.4",
          variant: "high",
          profileId: "Hephaestus (Deep Agent)",
        },
        sourceSession: {
          externalSessionId: sourceSession.externalSessionId,
          runtimeKind: sourceSession.runtimeKind,
          workingDirectory: sourceSession.workingDirectory,
        },
      }),
    ).resolves.toMatchObject({ externalSessionId: "forked-session" });
    expect(canonicalizedPaths).toEqual([sourceSession.workingDirectory, "/tmp/repo"]);
    expect(preparedLeases).toEqual([["/tmp/repo", "task-1", "build"]]);
    expect(completedLeaseIds).toEqual(["injected-lease"]);
  });
});
