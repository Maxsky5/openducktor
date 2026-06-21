import { describe, expect, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import { getAgentSession, replaceAgentSession } from "@/state/agent-session-collection";
import type { UpdateSession } from "../events/session-event-types";
import { createSessionObserversRefFixture } from "../test-utils";
import {
  buildSession,
  createSessionActions,
  createSessionsRef,
  getSession,
} from "./session-actions.test-helpers";

describe("agent-orchestrator/handlers/session-actions model", () => {
  test("updates and persists selected model for an unobserved idle session without runtime sync", () => {
    const adapter = new OpencodeSdkAdapter();
    const originalUpdateSessionModel = adapter.updateSessionModel;
    const modelCalls: Array<Parameters<OpencodeSdkAdapter["updateSessionModel"]>[0]> = [];
    adapter.updateSessionModel = (input) => {
      modelCalls.push(input);
    };

    const sessionsRef = createSessionsRef([buildSession({ status: "idle" })]);
    const updateSessionOptions: Array<Parameters<UpdateSession>[2]> = [];

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

      expect(modelCalls).toHaveLength(0);
      expect(getSession(sessionsRef)?.selectedModel?.modelId).toBe("gpt-5");
      expect(updateSessionOptions).toEqual([{ persist: true }]);
    } finally {
      adapter.updateSessionModel = originalUpdateSessionModel;
    }
  });

  test("syncs selected model to the runtime for an observed live session", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalUpdateSessionModel = adapter.updateSessionModel;
    const modelCalls: Array<Parameters<OpencodeSdkAdapter["updateSessionModel"]>[0]> = [];
    adapter.updateSessionModel = (input) => {
      modelCalls.push(input);
    };

    const sessionsRef = createSessionsRef([buildSession()]);
    const sessionObserversRef = createSessionObserversRefFixture();
    await sessionObserversRef.current.ensureObserver(getSession(sessionsRef), async () => () => {});
    const updateSessionOptions: Array<Parameters<UpdateSession>[2]> = [];

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      sessionObserversRef,
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
      expect(modelCalls[0]).toEqual({
        externalSessionId: "session-1",
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
        model: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
        },
      });
      expect(getSession(sessionsRef)?.selectedModel?.modelId).toBe("gpt-5");
      expect(updateSessionOptions).toEqual([{ persist: true }]);
    } finally {
      adapter.updateSessionModel = originalUpdateSessionModel;
    }
  });

  test("keeps the durable model selection when observed runtime sync throws", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalUpdateSessionModel = adapter.updateSessionModel;
    adapter.updateSessionModel = () => {
      throw new Error("Unknown session: session-1");
    };

    const sessionsRef = createSessionsRef([buildSession()]);
    const sessionObserversRef = createSessionObserversRefFixture();
    await sessionObserversRef.current.ensureObserver(getSession(sessionsRef), async () => () => {});

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      sessionObserversRef,
    });

    try {
      expect(() =>
        actions.updateAgentSessionModel(getSession(sessionsRef), {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
        }),
      ).toThrow("Unknown session: session-1");
      expect(getSession(sessionsRef)?.selectedModel?.modelId).toBe("gpt-5");
    } finally {
      adapter.updateSessionModel = originalUpdateSessionModel;
    }
  });

  test("fails instead of silently ignoring model changes for an unloaded session", () => {
    const adapter = new OpencodeSdkAdapter();
    const originalUpdateSessionModel = adapter.updateSessionModel;
    const modelCalls: Array<Parameters<OpencodeSdkAdapter["updateSessionModel"]>[0]> = [];
    adapter.updateSessionModel = (input) => {
      modelCalls.push(input);
    };

    const actions = createSessionActions({
      adapter,
      sessionsRef: createSessionsRef([]),
    });

    try {
      expect(() =>
        actions.updateAgentSessionModel(
          {
            externalSessionId: "missing-session",
            runtimeKind: "opencode",
            workingDirectory: "/repo/worktree",
          },
          {
            runtimeKind: "opencode",
            providerId: "openai",
            modelId: "gpt-5",
          },
        ),
      ).toThrow("Session 'missing-session' is not loaded.");
      expect(modelCalls).toHaveLength(0);
    } finally {
      adapter.updateSessionModel = originalUpdateSessionModel;
    }
  });
});
