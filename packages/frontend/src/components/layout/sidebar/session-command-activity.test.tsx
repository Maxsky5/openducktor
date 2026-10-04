import { describe, expect, test } from "bun:test";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import {
  encodeTerminalProtocolFrame,
  TERMINAL_PROTOCOL_VERSION,
  type TerminalActivity,
  type TerminalActivityMessage,
  type TerminalContext,
} from "@openducktor/contracts";
import { createTerminalTransportController } from "@/features/terminals/terminal-transport-controller";
import { TerminalActivityContext } from "@/state/providers/terminal-activity-provider";
import { SessionPreviewCommands } from "./session-command-activity";
import { SessionNavigationList } from "./session-navigation-list";
import { SessionNavigationTestProvider } from "./session-navigation-test-provider";
import {
  alphaWorkspace,
  betaWorkspace,
  navigationModel,
  NOW,
  taskSessionEntry,
  workspaceSessionEntry,
} from "./session-navigation.test-support";

const command = (terminalId: string, context: TerminalContext): TerminalActivity => ({
  kind: "terminal",
  command: "bun test",
  summary: {
    terminalId,
    label: "bun test",
    initialWorkingDir: "/repo/worktree",
    lifecycle: "running",
    createdAt: "2026-10-04T12:00:00.000Z",
    exit: null,
    context,
  },
});

const harness = async () => {
  let onFrame = (_frame: Uint8Array): void => {
    throw new Error("Transport is not connected");
  };
  let disconnect = (): void => {
    throw new Error("Transport is not connected");
  };
  const controller = createTerminalTransportController(
    {
      connect: async (receive, changeState) => {
        onFrame = receive;
        disconnect = () => changeState("disconnected");
        return { send: async () => {}, close: () => {} };
      },
    },
    () => {},
  );
  await controller.connect();
  const emit = (message: TerminalActivityMessage) =>
    onFrame(encodeTerminalProtocolFrame({ message, payload: new Uint8Array() }));
  const snapshot = (commands: TerminalActivity[]) => {
    emit({ version: TERMINAL_PROTOCOL_VERSION, type: "activity_snapshot_start" });
    for (const activity of commands)
      emit({ version: TERMINAL_PROTOCOL_VERSION, type: "activity_updated", activity });
    emit({ version: TERMINAL_PROTOCOL_VERSION, type: "activity_snapshot_end" });
  };
  return { controller, snapshot, emit, disconnect: () => disconnect() };
};

describe("session command activity", () => {
  test("shows all task commands on each role and keeps workspace chats and repositories separate", async () => {
    const { controller, snapshot, emit } = await harness();
    const entries = [
      taskSessionEntry("build", { taskId: "task" }),
      taskSessionEntry("qa", { taskId: "task", role: "qa" }),
      taskSessionEntry("other", { taskId: "task", workspace: betaWorkspace }),
      workspaceSessionEntry("chat"),
      workspaceSessionEntry("other-chat"),
    ];
    const taskOwner = { repoPath: alphaWorkspace.repoPath, taskId: "task" };
    const chatOwner = {
      kind: "workspace_session" as const,
      repoPath: alphaWorkspace.repoPath,
      workspaceId: alphaWorkspace.workspaceId,
      sessionId: "chat",
    };
    const view = render(
      <TerminalActivityContext value={controller}>
        <SessionNavigationTestProvider>
          <SessionNavigationList
            model={navigationModel({ recent: entries })}
            selection={{ entryKey: null, visibleKey: null }}
            now={NOW}
            onOpen={() => {}}
            onRetry={() => {}}
          />
        </SessionNavigationTestProvider>
      </TerminalActivityContext>,
    );
    try {
      await act(async () =>
        snapshot([
          command("terminal", taskOwner),
          { ...command("server", taskOwner), kind: "dev_server", command: "bun run dev" },
          command("chat-terminal", chatOwner),
        ]),
      );
      for (const name of ["Task build", "Task qa"]) {
        const row = screen.getByRole("button", { name: new RegExp(name) });
        expect(within(row).getByRole("img", { name: "2 active commands" })).toBeTruthy();
      }
      expect(
        within(screen.getByRole("button", { name: /Chat chat/ })).getByRole("img", {
          name: "1 active command",
        }),
      ).toBeTruthy();
      for (const name of ["Task other", "Chat other-chat"])
        expect(
          within(screen.getByRole("button", { name: new RegExp(name) })).queryByRole("img", {
            name: /active command/,
          }),
        ).toBeNull();
      await act(async () => {
        emit({
          version: TERMINAL_PROTOCOL_VERSION,
          type: "activity_removed",
          terminalId: "terminal",
        });
        emit({
          version: TERMINAL_PROTOCOL_VERSION,
          type: "activity_removed",
          terminalId: "server",
        });
      });
      expect(
        within(screen.getByRole("button", { name: /Task build/ })).queryByRole("img", {
          name: /active command/,
        }),
      ).toBeNull();
    } finally {
      view.unmount();
      await controller.dispose();
    }
  });

  test("shows the count and command details on focus, and exposes connection loss", async () => {
    const { controller, snapshot, disconnect } = await harness();
    const entry = workspaceSessionEntry("chat");
    const owner = {
      kind: "workspace_session" as const,
      repoPath: alphaWorkspace.repoPath,
      workspaceId: alphaWorkspace.workspaceId,
      sessionId: "chat",
    };
    const view = render(
      <TerminalActivityContext value={controller}>
        <SessionPreviewCommands entry={entry} />
      </TerminalActivityContext>,
    );
    try {
      await act(async () =>
        snapshot([
          {
            ...command("server", owner),
            kind: "dev_server",
            command: "bun run dev --port 3000",
            summary: { ...command("server", owner).summary, label: "Web app" },
          },
          command("shell", owner),
        ]),
      );
      const indicator = screen.getByRole("button", { name: "2 active commands" });
      expect(indicator.textContent).toBe("2");
      fireEvent.focus(indicator);
      const details = await screen.findByRole("tooltip");
      expect(details.textContent).toContain("Dev servers · 1");
      expect(details.textContent).toContain("Web app");
      expect(details.textContent).toContain("bun run dev --port 3000");
      expect(details.textContent).toContain("Terminals · 1");
      expect(details.textContent).toContain("bun test");
      expect(details.textContent).not.toContain("/repo/worktree");
      await act(async () => disconnect());
      expect(screen.getByRole("alert").textContent).toContain("Command status unavailable");
      expect(screen.queryByRole("button", { name: "2 active commands" })).toBeNull();
    } finally {
      view.unmount();
      await controller.dispose();
    }
  });
});
