import { describe, expect, test } from "bun:test";
import { invokeStopAgentSession } from "./use-agent-chat-surface-model";

describe("invokeStopAgentSession", () => {
  test("invokes stop and attaches a local rejection handler", () => {
    const stopCalls: string[] = [];
    const catchState: { rejectionHandler?: (error: Error) => unknown } = {};
    const stopPromise = {
      catch(handler: (error: Error) => unknown) {
        catchState.rejectionHandler = handler;
        return Promise.resolve();
      },
    } as Promise<void>;

    const result = invokeStopAgentSession("session-1", (sessionId) => {
      stopCalls.push(sessionId);
      return stopPromise;
    });

    expect(result).toBeUndefined();
    expect(stopCalls).toEqual(["session-1"]);
    expect(catchState.rejectionHandler).toBeFunction();
    if (!catchState.rejectionHandler) {
      throw new Error("Expected stop rejection handler to be attached");
    }
    expect(catchState.rejectionHandler(new Error("stop failed"))).toBeUndefined();
  });

  test("does nothing when no session or stop operation is available", () => {
    const stopCalls: string[] = [];
    const stopSession = async (sessionId: string): Promise<void> => {
      stopCalls.push(sessionId);
    };

    expect(invokeStopAgentSession(null, stopSession)).toBeUndefined();
    expect(invokeStopAgentSession("session-1", undefined)).toBeUndefined();

    expect(stopCalls).toEqual([]);
  });
});
