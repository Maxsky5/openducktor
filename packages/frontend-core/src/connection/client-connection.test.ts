import { afterEach, describe, expect, test } from "bun:test";
import type {
  StartupOperationContext,
  StartupOperationSnapshot,
  TerminalListFilter,
  TerminalListResponse,
} from "@openducktor/contracts";
import { HostInvokeError } from "@openducktor/host-client";
import { createTextSegment } from "../drafts/agent-chat-composer-draft";
import { AGENT_CHAT_DRAFT_STORAGE_MAX_BYTES } from "../drafts/agent-chat-draft-storage";
import { createFeedbackFake } from "../test-support/feedback-fake";
import {
  createTestClientConnection,
  createTestHostConnection,
} from "../test-support/test-client-connection";
import { terminalQueryKeys } from "../queries/terminals";
import type { ClientConnection } from "./client-connection";
import type { StartupProgressListener } from "./host-connection";

const identity = { workspaceId: "workspace", workspaceSessionId: "chat-1" };
const draftOf = (text: string) => ({
  segments: [createTextSegment(text, "text-1")],
  attachments: [],
});

const connections: ClientConnection[] = [];
const openConnection = () => {
  const feedback = createFeedbackFake();
  const connection = createTestClientConnection({ feedback, scheduleTask: () => () => {} });
  connections.push(connection);
  return { connection, feedback };
};

afterEach(async () => {
  for (const connection of connections) connection.drafts.chat.clear(identity);
  await Promise.all(connections.splice(0).map((connection) => connection.dispose()));
});

describe("client connection chat drafts", () => {
  test("tells the user on each save that a long draft is not kept", async () => {
    const { connection, feedback } = openConnection();
    const long = "x".repeat(AGENT_CHAT_DRAFT_STORAGE_MAX_BYTES);

    connection.drafts.chat.set(identity, null, draftOf(long));
    await connection.drafts.chat.flush(identity);
    connection.drafts.chat.set(identity, null, draftOf(`${long}y`));
    await connection.drafts.chat.flush(identity);

    const warnings = feedback.shownOf("warning");
    expect(warnings).toHaveLength(2);
    expect(warnings[0]?.message).toBe("This chat draft is too long to keep on this device");
    expect(warnings[0]?.options?.description).toBe(
      "The app does not save drafts over 20 KB. Shorten the draft or send it before you close the app.",
    );
    // Both saves use one message ID, so the second message replaces the first.
    expect(warnings[1]?.options?.id).toBe(warnings[0]?.options?.id);
    expect(connection.drafts.chat.hydrate(identity, null)).toEqual(draftOf(`${long}y`));
  });

  test("saves a draft under the limit without a message", async () => {
    const { connection, feedback } = openConnection();

    connection.drafts.chat.set(identity, null, draftOf("Short draft"));
    await connection.drafts.chat.flush(identity);

    expect(feedback.shown).toEqual([]);
  });
});

test.each(["stream", "command result", "command failure"])(
  "late action results from a %s update loaded terminals after startup feedback is dismissed",
  async (delivery) => {
    let listener: StartupProgressListener | undefined;
    const connection = createTestClientConnection({
      host: createTestHostConnection({
        subscribeStartupProgress: async (next) => {
          listener = next;
          return () => {};
        },
      }),
      scheduleTask: () => () => {},
    });
    connections.push(connection);
    const terminal = {
      terminalId: "action-terminal",
      label: "Install dependencies",
      context: {
        kind: "workspace_session" as const,
        workspaceId: "workspace",
        sessionId: "child",
        repoPath: "/repo",
      },
      initialWorkingDir: "/repo/worktree",
      createdAt: "2026-10-27T12:00:00.000Z",
      lifecycle: "running" as const,
      exit: null,
      startedBy: "host" as const,
    };
    const taskTerminal = {
      ...terminal,
      terminalId: "task-action-terminal",
      context: { repoPath: "/repo", taskId: "task" },
    };
    const cases: { filter: TerminalListFilter; data?: TerminalListResponse; updated: boolean }[] = [
      {
        filter: { kind: "workspace_session", workspaceId: "workspace", sessionId: "child" },
        data: { hostInstanceId: "host", terminals: [terminal] },
        updated: true,
      },
      {
        filter: { kind: "task", repoPath: "/repo", taskId: "task" },
        data: { hostInstanceId: "host", terminals: [taskTerminal] },
        updated: true,
      },
      {
        filter: { kind: "all" },
        data: { hostInstanceId: "host", terminals: [terminal, taskTerminal] },
        updated: true,
      },
      {
        filter: { kind: "task", repoPath: "/repo", taskId: "other-host" },
        data: { hostInstanceId: "other-host", terminals: [terminal] },
        updated: false,
      },
      {
        filter: { kind: "task", repoPath: "/repo", taskId: "other-terminal" },
        data: {
          hostInstanceId: "host",
          terminals: [{ ...terminal, terminalId: "other-terminal" }],
        },
        updated: false,
      },
      {
        filter: { kind: "workspace_session", workspaceId: "workspace", sessionId: "unloaded" },
        updated: false,
      },
    ];
    for (const item of cases) {
      if (item.data)
        connection.queryClient.setQueryData(terminalQueryKeys.filter(item.filter), item.data);
    }
    const origin = {
      workspaceId: "workspace",
      repoPath: "/repo",
      scope: { kind: "workspace" as const, sessionId: "source" },
    };
    const id = connection.startupAttempts.begin({
      origin,
      label: "Fork chat",
      presentation: "dialog",
    });
    const dispatched = Promise.withResolvers<StartupOperationContext>();
    const outcome = Promise.withResolvers<{ startupProgress: StartupOperationSnapshot }>();
    const command = connection.startupAttempts
      .operation(id, (context) => {
        dispatched.resolve(context);
        return outcome.promise;
      })
      .catch((cause: unknown) => cause);
    const context = await dispatched.promise;
    const progress: StartupOperationSnapshot = {
      ...origin,
      context,
      hostInstanceId: "host",
      revision: 1,
      phase: "failed",
      steps: [],
      ownership: { state: "not_saved" },
    };
    await listener?.({
      channel: "openducktor://session-startup-progress",
      payload: progress,
    });
    connection.startupAttempts.dismiss(id);
    expect(connection.startupAttempts.getSnapshot()).toEqual([]);
    const result = {
      type: "exited" as const,
      exitCode: 1,
      signal: null,
      outputTail: ["Install failed."],
    };

    const late: StartupOperationSnapshot = {
      ...progress,
      revision: 2,
      steps: [terminal, taskTerminal].map((item) => ({
        id: item.terminalId,
        label: item.label,
        state: "failed",
        details: [],
        action: {
          actionId: "install",
          command: "bun install",
          waitBeforeAgentStart: false,
          terminalId: item.terminalId,
          result,
        },
      })),
    };
    if (delivery === "stream") {
      outcome.resolve({ startupProgress: progress });
      await command;
      await listener?.({ channel: "openducktor://session-startup-progress", payload: late });
    } else if (delivery === "command result") {
      outcome.resolve({ startupProgress: late });
    } else {
      outcome.reject(
        new HostInvokeError("Startup failed", { kind: "session_startup", startupProgress: late }),
      );
    }
    const settlement = await command;
    if (delivery === "command failure") expect(settlement).toBeInstanceOf(HostInvokeError);
    else expect(settlement).toEqual({ startupProgress: delivery === "stream" ? progress : late });

    for (const item of cases) {
      const data = connection.queryClient.getQueryData<TerminalListResponse>(
        terminalQueryKeys.filter(item.filter),
      );
      if (item.updated) {
        for (const summary of data?.terminals ?? [])
          expect(summary.initialCommandResult).toEqual(result);
        expect(data?.terminals).toHaveLength(item.data!.terminals.length);
      } else expect(data).toBe(item.data);
    }
    expect(connection.startupAttempts.getSnapshot()).toEqual([]);
  },
);
