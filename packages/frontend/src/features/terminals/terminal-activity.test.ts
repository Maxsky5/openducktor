import { describe, expect, test } from "bun:test";
import {
  decodeTerminalProtocolFrame,
  encodeTerminalProtocolFrame,
  TERMINAL_PROTOCOL_VERSION,
  type TerminalActivity,
  type TerminalActivityMessage,
  type TerminalContext,
} from "@openducktor/contracts";
import type { TerminalBridge, TerminalTransportState } from "@/lib/shell-bridge";
import { terminalActivityOwnerKey } from "./terminal-activity-store";
import { createTerminalTransportController } from "./terminal-transport-controller";

const command = (terminalId: string, context: TerminalContext): TerminalActivity => ({
  kind: "terminal",
  command: "bun test",
  summary: {
    terminalId,
    label: "bun test",
    initialWorkingDir: "/repo/worktree",
    context,
    lifecycle: "running",
    createdAt: "2026-10-04T12:00:00.000Z",
    exit: null,
  },
});

const harness = () => {
  const connections: Array<{
    receive: (frame: Uint8Array) => void;
    changeState: (state: TerminalTransportState) => void;
    sent: string[];
  }> = [];
  const bridge: TerminalBridge = {
    connect: async (receive, changeState) => {
      const sent: string[] = [];
      const connection = { receive, changeState, sent };
      connections.push(connection);
      return {
        send: async (frame) => {
          connection.sent.push(decodeTerminalProtocolFrame(frame).message.type);
        },
        close: () => {},
      };
    },
  };
  const controller = createTerminalTransportController(bridge, () => {});
  const receive = (message: TerminalActivityMessage, index = connections.length - 1) => {
    connections[index]!.receive(
      encodeTerminalProtocolFrame({ message, payload: new Uint8Array() }),
    );
  };
  const snapshot = (commands: TerminalActivity[]) => {
    receive({ version: TERMINAL_PROTOCOL_VERSION, type: "activity_snapshot_start" });
    for (const activity of commands)
      receive({ version: TERMINAL_PROTOCOL_VERSION, type: "activity_updated", activity });
    receive({ version: TERMINAL_PROTOCOL_VERSION, type: "activity_snapshot_end" });
  };
  return { controller, connections, receive, snapshot };
};

describe("terminal activity transport", () => {
  test("shares one metadata observer, commits snapshots together, and keeps owner reads stable", async () => {
    const { controller, connections, receive } = harness();
    const task = { repoPath: "/repo", taskId: "task" };
    const otherRepo = { repoPath: "/other", taskId: "task" };
    const chat = {
      kind: "workspace_session" as const,
      repoPath: "/repo",
      workspaceId: "workspace",
      sessionId: "chat",
    };
    const otherChat = { ...chat, sessionId: "other" };
    let updates = 0;
    const stop = controller.subscribeActivity(() => {
      updates += 1;
    });
    const stopSecond = controller.subscribeActivity(() => {});
    try {
      await controller.connect();
      expect(connections[0]!.sent).toEqual(["observe_activity"]);
      receive({ version: TERMINAL_PROTOCOL_VERSION, type: "activity_snapshot_start" });
      for (const [id, context] of [
        ["task-command", task],
        ["other-repo", otherRepo],
        ["chat-command", chat],
        ["other-chat", otherChat],
      ] as const) {
        receive({
          version: TERMINAL_PROTOCOL_VERSION,
          type: "activity_updated",
          activity: command(id, context),
        });
      }
      const key = terminalActivityOwnerKey(task);
      expect(controller.readActivity(key).status).toBe("loading");
      expect(updates).toBe(0);
      receive({ version: TERMINAL_PROTOCOL_VERSION, type: "activity_snapshot_end" });
      expect(updates).toBe(1);
      const state = controller.readActivity(key);
      expect(state.status).toBe("ready");
      expect(state.commands.map((item) => item.summary.terminalId)).toEqual(["task-command"]);
      expect(
        controller
          .readActivity(terminalActivityOwnerKey(chat))
          .commands.map((item) => item.summary.terminalId),
      ).toEqual(["chat-command"]);
      receive({
        version: TERMINAL_PROTOCOL_VERSION,
        type: "activity_updated",
        activity: {
          ...command("other-repo", otherRepo),
          command: "bun run dev",
          kind: "dev_server",
        },
      });
      expect(controller.readActivity(key)).toBe(state);
      receive({
        version: TERMINAL_PROTOCOL_VERSION,
        type: "activity_removed",
        terminalId: "task-command",
      });
      expect(controller.readActivity(key).commands).toEqual([]);
      stop();
      await Promise.resolve();
      expect(connections[0]!.sent).toEqual(["observe_activity"]);
      stopSecond();
      await Promise.resolve();
      expect(connections[0]!.sent).toEqual(["observe_activity", "unobserve_activity"]);
    } finally {
      await controller.dispose();
    }
  });

  test("refreshes after reconnect or resubscription and ignores frames from the old connection", async () => {
    const { controller, connections, receive, snapshot } = harness();
    const owner = { repoPath: "/repo", taskId: "task" };
    const key = terminalActivityOwnerKey(owner);
    let stop = controller.subscribeActivity(() => {});
    try {
      await controller.connect();
      snapshot([command("old", owner)]);
      connections[0]!.changeState("disconnected");
      expect(controller.readActivity(key)).toMatchObject({
        status: "unavailable",
        error: "Terminal connection lost. Reconnecting…",
      });
      await controller.connect();
      expect(connections[1]!.sent).toEqual(["observe_activity"]);
      snapshot([command("new", owner)]);
      receive(
        { version: TERMINAL_PROTOCOL_VERSION, type: "activity_removed", terminalId: "new" },
        0,
      );
      expect(controller.readActivity(key).commands.map((item) => item.summary.terminalId)).toEqual([
        "new",
      ]);
      stop();
      await Promise.resolve();
      stop = controller.subscribeActivity(() => {});
      expect(controller.readActivity(key).status).toBe("loading");
      snapshot([]);
      expect(controller.readActivity(key)).toMatchObject({ status: "ready", commands: [] });
    } finally {
      stop();
      await controller.dispose();
    }
  });
});
