import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import { createAgentSessionsStore } from "@/state/agent-sessions-store";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { createSession } from "./agent-session-hook-test-fixtures";
import { useAgentSessionMutations } from "./use-agent-session-mutations";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useAgentSessionMutations", () => {
  test("persists changed workflow sessions", async () => {
    const store = createAgentSessionsStore();
    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: { "external-1": createSession() },
    };
    const persisted: AgentSessionRecord[] = [];
    const Harness = () =>
      useAgentSessionMutations({
        workspaceRepoPath: "/tmp/repo",
        sessionsRef,
        commitSessions: (updater) => {
          sessionsRef.current =
            typeof updater === "function" ? updater(sessionsRef.current) : updater;
          store.setSessionsById(sessionsRef.current);
        },
        persistSessionRecord: async (_taskId, record) => {
          persisted.push(record);
        },
      });
    const harness = createHookHarness(Harness, undefined);
    await harness.mount();
    await harness.run(({ updateSession }) => {
      updateSession("external-1", (current) => ({ ...current, status: "running" }), {
        persist: true,
      });
    });
    await Promise.resolve();

    expect(sessionsRef.current["external-1"]?.status).toBe("running");
    expect(persisted).toHaveLength(1);

    await harness.run(({ updateSession }) => {
      updateSession("external-1", (current) => ({ ...current, status: "idle" }), {
        persist: true,
      });
    });
    await Promise.resolve();

    expect(persisted).toHaveLength(2);
    await harness.unmount();
  });

  test("rejects persisted updates for role-less sessions before local commit", async () => {
    const store = createAgentSessionsStore();
    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: { "external-1": createSession() },
    };
    const persisted: AgentSessionRecord[] = [];
    const Harness = () =>
      useAgentSessionMutations({
        workspaceRepoPath: "/tmp/repo",
        sessionsRef,
        commitSessions: (updater) => {
          sessionsRef.current =
            typeof updater === "function" ? updater(sessionsRef.current) : updater;
          store.setSessionsById(sessionsRef.current);
        },
        persistSessionRecord: async (_taskId, record) => {
          persisted.push(record);
        },
      });
    const harness = createHookHarness(Harness, undefined);
    await harness.mount();

    expect(() =>
      harness.getLatest().updateSession("external-1", (current) => ({ ...current, role: null }), {
        persist: true,
      }),
    ).toThrow("Session 'external-1' is not a workflow session.");

    expect(sessionsRef.current["external-1"]?.role).not.toBeNull();
    expect(persisted).toEqual([]);
    await harness.unmount();
  });
});
