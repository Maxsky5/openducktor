import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { TerminalTab } from "@openducktor/frontend-core/terminals/terminal-presentation-state";
import { createTerminalTransportController } from "@openducktor/frontend-core/terminals/terminal-transport-controller";
import { createTerminalSessionsFixture } from "@/test-utils/session-panel-fixtures";
import { QueryProvider } from "@/test-utils/query-provider";
import { Tabs } from "@/components/ui/tabs";
import { TerminalLayer } from "./terminal-layer";

test("keeps the setup command result visible in its running terminal after startup feedback ends", () => {
  const tab: TerminalTab = {
    tabId: "setup",
    terminalId: "setup-terminal",
    summary: {
      terminalId: "setup-terminal",
      label: "Install dependencies",
      context: { repoPath: "/repo", taskId: "task" },
      initialWorkingDir: "/worktrees/task",
      createdAt: "2026-10-26T00:00:00.000Z",
      lifecycle: "running",
      exit: null,
      startedBy: "host",
      initialCommandResult: {
        type: "exited",
        exitCode: 42,
        signal: null,
        outputTail: ["Install failed"],
      },
    },
    awaitingLifecycleSync: false,
    error: null,
    requestState: "ready",
  };
  const controller = createTerminalTransportController(
    { connect: async () => ({ send: async () => {}, close: () => {} }) },
    () => {},
  );
  const markup = renderToStaticMarkup(
    <QueryProvider>
      <Tabs value="setup">
        <TerminalLayer
          terminals={createTerminalSessionsFixture({ controller })}
          mounts={[{ key: "setup", scopeKey: "task", tab, value: "setup" }]}
          activeKey="setup"
          isVisible
          isInteractive
          focusRequest={0}
          tabIdBase="terminals"
        />
      </Tabs>
    </QueryProvider>,
  );
  expect(markup).toContain('aria-label="Setup command result"');
  expect(markup).toContain("Command exited with code 42.");
});
