import { expect, test } from "bun:test";
import type { StartupOperationSnapshot } from "@openducktor/contracts";
import { act, fireEvent, render } from "@testing-library/react";
import { QueryProvider } from "@/test-utils/query-provider";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import type { StartupAttempt } from "@openducktor/frontend-core/sessions/startup/startup-attempt-store";
import { StartupTrace } from "./session-startup-trace";

const progress = (): StartupOperationSnapshot => ({
  context: { startupAttemptId: "start", operationId: "prepare" },
  hostInstanceId: "host",
  revision: 1,
  workspaceId: "workspace",
  repoPath: "/repo",
  scope: { kind: "task", taskId: "task", role: "build" },
  phase: "running",
  ownership: { state: "not_saved" },
  steps: [
    {
      id: "checkout",
      label: "Create worktree",
      state: "completed",
      details: ["Created /worktrees/task on branch odt/task."],
    },
    {
      id: "install",
      label: "Install dependencies",
      state: "running",
      details: [],
      action: { actionId: "install", command: "bun install", waitBeforeAgentStart: true },
    },
    { id: "session", label: "Prepare session", state: "pending", details: [] },
  ],
});

const attempt = (): StartupAttempt => ({
  id: "start",
  origin: {
    workspaceId: "workspace",
    repoPath: "/repo",
    scope: { kind: "task", taskId: "task", role: "build" },
  },
  label: "Start Builder session for task",
  status: { phase: "running", confirmation: "current" },
  operations: [progress()],
  ownership: { state: "not_saved" },
  presentation: "dialog",
  instructionRequired: false,
});

test("keeps the same rows and expanded details as startup fails and dependent work does not run", async () => {
  const connection = createTestClientConnection();
  const current = attempt();
  const view = render(
    <QueryProvider connection={connection}>
      <StartupTrace attempt={current} />
    </QueryProvider>,
  );
  try {
    const list = view.getByRole("list", { name: "Session startup steps" });
    const checkout = list.firstElementChild;
    const details = checkout?.querySelector("details");
    if (!details) throw new Error("Checkout details are missing.");
    await act(async () => {
      details.open = true;
      fireEvent(details, new Event("toggle"));
    });
    const snapshot = progress();
    snapshot.revision = 2;
    snapshot.phase = "failed";
    snapshot.steps[1] = {
      ...snapshot.steps[1]!,
      state: "failed",
      failure: {
        stage: "action",
        code: "exit",
        message: "Install dependencies exited with code 1.",
        nextAction: "Fix the command before you start again.",
      },
    };
    snapshot.steps[2] = { ...snapshot.steps[2]!, state: "not_run" };
    view.rerender(
      <QueryProvider connection={connection}>
        <StartupTrace
          attempt={{
            ...current,
            operations: [snapshot],
            status: { phase: "failed", confirmation: "current" },
          }}
        />
      </QueryProvider>,
    );
    expect(list.firstElementChild).toBe(checkout);
    expect(details.open).toBe(true);
    expect(view.getByText("Created /worktrees/task on branch odt/task.")).toBeDefined();
    expect(view.getByText("Install dependencies exited with code 1.")).toBeDefined();
    expect(view.getByText("Did not run")).toBeDefined();
  } finally {
    view.unmount();
  }
});

test("preserves details and reading position when the same attempt moves to a notification", async () => {
  const connection = createTestClientConnection();
  const current = attempt();
  const view = render(
    <QueryProvider connection={connection}>
      <StartupTrace attempt={current} />
    </QueryProvider>,
  );
  const details = view.getByRole("list").querySelector("details");
  if (!details) throw new Error("Checkout details are missing.");
  await act(async () => {
    details.open = true;
    fireEvent(details, new Event("toggle"));
  });
  const scroll = view.getByRole("list").parentElement!;
  scroll.scrollTop = 37;
  fireEvent.scroll(scroll);
  view.unmount();
  const notice = render(
    <QueryProvider connection={connection}>
      <StartupTrace attempt={{ ...current, presentation: "notification" }} />
    </QueryProvider>,
  );
  try {
    expect(notice.getByRole("list").querySelector("details")?.open).toBe(true);
    expect(notice.getByRole("list").parentElement?.scrollTop).toBe(37);
    expect(document.activeElement?.closest("[data-startup-attempt]")).toBeNull();
  } finally {
    notice.unmount();
  }
});

test("shows an asynchronous action as failed when a signal accompanies exit code zero", () => {
  const connection = createTestClientConnection();
  const current = attempt();
  const operation = current.operations[0]!;
  operation.steps = [
    {
      id: "install",
      label: "Install dependencies",
      state: "completed",
      details: [],
      action: {
        actionId: "install",
        command: "bun install",
        waitBeforeAgentStart: false,
        result: { type: "exited", exitCode: 0, signal: "SIGTERM", outputTail: [] },
      },
    },
  ];
  const view = render(
    <QueryProvider connection={connection}>
      <StartupTrace attempt={current} />
    </QueryProvider>,
  );
  try {
    expect(view.getByText("Failed")).toBeDefined();
    expect(view.queryByText("Completed")).toBeNull();
    expect(view.getByText("Command ended with signal SIGTERM.")).toBeDefined();
  } finally {
    view.unmount();
  }
});

test("shows the exact saved draft without an Open session action or a replacement start", () => {
  const connection = createTestClientConnection();
  const current = attempt();
  const saved: StartupAttempt = {
    ...current,
    status: { phase: "failed", confirmation: "current" },
    ownership: {
      state: "saved",
      target: {
        kind: "workspace",
        record: {
          id: "saved-draft",
          runtimeKind: "codex",
          externalSessionId: null,
          executionTarget: { kind: "local_repo_root", workingDirectory: "/repo/saved-directory" },
          roleSnapshot: null,
          selectedModel: null,
          generatedTitle: null,
          manualTitle: null,
          targetBranch: null,
          createdAt: 1,
          updatedAt: 1,
          archivedAt: null,
        },
      },
    },
  };
  const view = render(
    <QueryProvider connection={connection}>
      <StartupTrace attempt={saved} />
    </QueryProvider>,
  );
  try {
    fireEvent.click(view.getByRole("button", { name: "Inspect saved session" }));
    expect(view.getByText("saved-draft")).toBeDefined();
    expect(view.getByText("/repo/saved-directory")).toBeDefined();
    expect(view.queryByRole("button", { name: "Open session" })).toBeNull();
    expect(view.queryByRole("button", { name: /retry|start again/i })).toBeNull();
  } finally {
    view.unmount();
  }
});
