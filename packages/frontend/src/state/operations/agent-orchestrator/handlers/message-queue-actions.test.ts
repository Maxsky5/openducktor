import { describe, expect, test } from "bun:test";
import type {
  AgentMessageQueueManageInput,
  AgentMessageQueueManageResult,
} from "@openducktor/contracts";
import type { AcceptedAgentUserMessage, AgentEnginePort } from "@openducktor/core";
import { HostInvokeError } from "@openducktor/host-client";
import { createAgentMessageQueuesStore } from "@/state/agent-message-queues-store";
import { getAgentSession, replaceAgentSessionByIdentity } from "@/state/agent-session-collection";
import { createAgentMessageQueueSnapshot } from "@/test-utils/agent-message-send-fixture";
import { someSessionMessage } from "../support/messages";
import { createManageAgentMessageQueue } from "./message-queue-actions";
import { buildSession, createSessionsRef } from "./session-actions.test-helpers";

const repoPath = "/tmp/repo";

const target = {
  repoPath,
  runtimeKind: "opencode" as const,
  workingDirectory: "/tmp/repo/worktree",
  externalSessionId: "session-1",
  sessionScope: { kind: "workflow" as const, taskId: "task-1", role: "build" as const },
};

const accepted: AcceptedAgentUserMessage = {
  type: "user_message",
  externalSessionId: "session-1",
  timestamp: "2026-10-08T10:01:00.000Z",
  messageId: "message-steered",
  message: "Check the tests too",
  parts: [{ kind: "text", text: "Check the tests too" }],
  state: "queued",
};

const createHarness = (
  status: "running" | "stopped",
  manage: (input: AgentMessageQueueManageInput) => Promise<AgentMessageQueueManageResult>,
) => {
  const calls: string[] = [];
  const sessionsRef = createSessionsRef([buildSession({ status })]);
  const messageQueues = createAgentMessageQueuesStore();
  const adapter: Pick<AgentEnginePort, "manageMessageQueue" | "resumeSession"> = {
    resumeSession: async (input) => {
      calls.push("resume");
      return {
        externalSessionId: input.externalSessionId,
        runtimeKind: input.runtimeKind,
        workingDirectory: input.workingDirectory,
        startedAt: "2026-02-22T08:00:00.000Z",
        status: "idle",
      };
    },
    manageMessageQueue: async (input) => {
      calls.push(`manage:${input.action.kind}`);
      return manage(input);
    },
  };
  const manageAgentMessageQueue = createManageAgentMessageQueue({
    workspaceRepoPath: repoPath,
    repoEpochRef: { current: 1 },
    currentWorkspaceRepoPathRef: { current: repoPath },
    adapter,
    messageQueues,
    readSessionSnapshot: (identity) => getAgentSession(sessionsRef.current, identity),
    updateSession: (identity, updater) => {
      const current = getAgentSession(sessionsRef.current, identity);
      if (!current) return null;
      const next = updater(current);
      sessionsRef.current = replaceAgentSessionByIdentity(sessionsRef.current, identity, next);
      return next;
    },
  });
  const identity = {
    externalSessionId: "session-1",
    runtimeKind: "opencode" as const,
    workingDirectory: "/tmp/repo/worktree",
  };
  const session = () => getAgentSession(sessionsRef.current, identity);
  return { manageAgentMessageQueue, calls, identity, messageQueues, session };
};

describe("createManageAgentMessageQueue", () => {
  test("applies the returned queue and shows a steered message once", async () => {
    const harness = createHarness("running", async () => ({
      queue: createAgentMessageQueueSnapshot({ target, revision: 4, texts: ["later"] }),
      acceptedMessage: accepted,
    }));

    await harness.manageAgentMessageQueue(harness.identity, {
      kind: "steer",
      submissionId: "submission-now",
    });

    expect(harness.messageQueues.getQueue({ ...harness.identity, repoPath })?.revision).toBe(4);
    const current = harness.session();
    expect(
      current ? someSessionMessage(current, (message) => message.id === "message-steered") : false,
    ).toBe(true);
  });

  test.each(["resume", "steer"] as const)(
    "reattaches a stopped session before %s delivers a message",
    async (kind) => {
      const harness = createHarness("stopped", async () => ({
        queue: createAgentMessageQueueSnapshot({ target, revision: 2, texts: ["first"] }),
      }));

      await harness.manageAgentMessageQueue(
        harness.identity,
        kind === "resume" ? { kind } : { kind, submissionId: "submission-first" },
      );

      expect(harness.calls).toEqual(["resume", `manage:${kind}`]);
      expect(harness.session()?.status).toBe("idle");
    },
  );

  test("keeps a stopped session stopped for an edit", async () => {
    const harness = createHarness("stopped", async () => ({
      queue: createAgentMessageQueueSnapshot({ target, revision: 2, texts: ["first"] }),
    }));

    await harness.manageAgentMessageQueue(harness.identity, {
      kind: "remove",
      submissionId: "submission-first",
    });

    expect(harness.calls).toEqual(["manage:remove"]);
    expect(harness.session()?.status).toBe("stopped");
  });

  test("shows a message that the agent received before a later failure", async () => {
    const harness = createHarness("running", async (input) => {
      throw new HostInvokeError(
        "The runtime accepted the message, but the session update failed.",
        {
          kind: "agent_session_message_accepted",
          sessionRef: {
            repoPath: input.repoPath,
            runtimeKind: input.runtimeKind,
            workingDirectory: input.workingDirectory,
            externalSessionId: input.externalSessionId,
          },
          acceptedMessage: accepted,
          stage: "record_message",
        },
      );
    });

    await harness.manageAgentMessageQueue(harness.identity, {
      kind: "steer",
      submissionId: "submission-now",
    });

    const current = harness.session();
    expect(
      current ? someSessionMessage(current, (message) => message.id === "message-steered") : false,
    ).toBe(true);
    expect(
      current
        ? someSessionMessage(
            current,
            (message) =>
              message.meta?.kind === "session_notice" && message.meta.reason === "session_error",
          )
        : false,
    ).toBe(true);
  });

  test("passes other failures to the caller", async () => {
    const harness = createHarness("running", async () => {
      throw new Error("Delivery of this message already started.");
    });

    const failure = await harness
      .manageAgentMessageQueue(harness.identity, { kind: "remove", submissionId: "submission-a" })
      .then(
        () => null,
        (error: Error) => error,
      );

    expect(failure?.message).toBe("Delivery of this message already started.");
  });
});
