import { describe, expect, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import { getAgentSession, replaceAgentSession } from "@/state/agent-session-collection";
import {
  buildSession,
  createSessionActions,
  createSessionsRef,
  getSession,
} from "./session-actions.test-helpers";

describe("agent-orchestrator/handlers/session-actions model", () => {
  test("updates selected model and persists the session selection", () => {
    const adapter = new OpencodeSdkAdapter();
    const originalUpdateSessionModel = adapter.updateSessionModel;
    const modelCalls: Array<Parameters<OpencodeSdkAdapter["updateSessionModel"]>[0]> = [];
    adapter.updateSessionModel = (input) => {
      modelCalls.push(input);
    };

    const sessionsRef = createSessionsRef([buildSession()]);
    const updateSessionOptions: Array<{ persist?: boolean } | undefined> = [];

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      updateSession: (identity, updater, options) => {
        const current = getAgentSession(sessionsRef.current, identity);
        if (!current) {
          return null;
        }
        updateSessionOptions.push(options);
        const nextSession = updater(current);
        sessionsRef.current = replaceAgentSession(sessionsRef.current, nextSession);
        return nextSession;
      },
    });

    try {
      actions.updateAgentSessionModel(getSession(sessionsRef), {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
      });

      expect(modelCalls).toHaveLength(1);
      expect(getSession(sessionsRef)?.selectedModel?.modelId).toBe("gpt-5");
      expect(updateSessionOptions).toEqual([{ persist: true }]);
    } finally {
      adapter.updateSessionModel = originalUpdateSessionModel;
    }
  });
});
