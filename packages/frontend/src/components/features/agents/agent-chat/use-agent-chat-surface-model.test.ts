import { describe, expect, test } from "bun:test";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import { invokeStopAgentSession } from "./use-agent-chat-surface-model";

const sessionIdentity = (externalSessionId: string): AgentSessionIdentity => ({
  externalSessionId,
  runtimeKind: "opencode",
  workingDirectory: `/repo/worktrees/${externalSessionId}`,
});

describe("invokeStopAgentSession", () => {
  test("invokes stop and registers a local rejection handler", () => {
    const stopCalls: AgentSessionIdentity[] = [];
    const catchState: { rejectionHandler?: (error: Error) => unknown } = {};
    const stopPromise = {
      catch(handler: (error: Error) => unknown) {
        catchState.rejectionHandler = handler;
        return Promise.resolve();
      },
    } as Promise<void>;

    const result = invokeStopAgentSession(sessionIdentity("session-1"), (session) => {
      stopCalls.push(session);
      return stopPromise;
    });

    expect(result).toBeUndefined();
    expect(stopCalls).toEqual([sessionIdentity("session-1")]);
    expect(catchState.rejectionHandler).toBeFunction();
    if (!catchState.rejectionHandler) {
      throw new Error("Expected stop rejection handler to be registered");
    }
    expect(catchState.rejectionHandler(new Error("stop failed"))).toBeUndefined();
  });

  test("does nothing when no session or stop operation is available", () => {
    const stopCalls: AgentSessionIdentity[] = [];
    const stopSession = async (session: AgentSessionIdentity): Promise<void> => {
      stopCalls.push(session);
    };

    expect(invokeStopAgentSession(null, stopSession)).toBeUndefined();
    expect(invokeStopAgentSession(sessionIdentity("session-1"), undefined)).toBeUndefined();

    expect(stopCalls).toEqual([]);
  });
});
