import { expect, test } from "bun:test";
import type { StartupOperationSnapshot } from "@openducktor/contracts";
import { act, fireEvent, render, within } from "@testing-library/react";
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
    {
      id: "verify",
      label: "Verify workspace",
      state: "pending",
      details: [],
      action: { actionId: "verify", command: "bun run typecheck", waitBeforeAgentStart: true },
    },
    { id: "copies", label: "Copy configured files", state: "completed", details: [] },
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
    const checkout = within(list).getAllByRole("listitem")[0]!;
    const details = within(checkout).getByRole("button", { name: /Create worktree.*Completed/ });
    expect(details.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      fireEvent.click(details);
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
    expect(within(list).getAllByRole("listitem")[0]).toBe(checkout);
    expect(within(checkout).getByRole("button", { name: /Create worktree.*Completed/ })).toBe(
      details,
    );
    expect(details.getAttribute("aria-expanded")).toBe("true");
    expect(view.getByText("Created /worktrees/task on branch odt/task.")).toBeDefined();
    expect(view.getByText("Install dependencies exited with code 1.")).toBeDefined();
    expect(view.getByRole("button", { name: /Verify workspace.*Did not run/ })).toBeDefined();
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
  const details = view.getByRole("button", { name: /Create worktree.*Completed/ });
  await act(async () => {
    fireEvent.click(details);
  });
  const scroll = view.getByRole("region", { name: "Session startup details" });
  scroll.scrollTop = 37;
  fireEvent.scroll(scroll);
  view.unmount();
  const notice = render(
    <QueryProvider connection={connection}>
      <StartupTrace attempt={{ ...current, presentation: "notification" }} />
    </QueryProvider>,
  );
  try {
    expect(
      notice
        .getByRole("button", { name: /Create worktree.*Completed/ })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(notice.getByText("Created /worktrees/task on branch odt/task.")).toBeDefined();
    expect(notice.getByRole("region", { name: "Session startup details" }).scrollTop).toBe(37);
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
    { id: "copies", label: "Copy configured files", state: "completed", details: [] },
  ];
  const view = render(
    <QueryProvider connection={connection}>
      <StartupTrace attempt={current} />
    </QueryProvider>,
  );
  try {
    const details = view.getByRole("button", { name: /Install dependencies.*Failed/ });
    fireEvent.click(details);
    expect(view.queryByText("Completed")).toBeNull();
    expect(view.getByText("Command ended with signal SIGTERM.")).toBeDefined();
  } finally {
    view.unmount();
  }
});

test("keeps cleanup guidance and exact saved draft inspection without a worktree trace or replacement start", () => {
  const connection = createTestClientConnection();
  const current = attempt();
  const saved: StartupAttempt = {
    ...current,
    status: { phase: "failed", confirmation: "current" },
    operations: [
      {
        ...progress(),
        phase: "failed",
        steps: [
          {
            id: "cleanup",
            label: "Stop unused native fork",
            state: "failed",
            details: ["Keep this checkout until Stop succeeds."],
            failure: {
              stage: "cleanup",
              code: "stop_failed",
              message: "Stop unused native fork failed.",
              nextAction: "Stop the native session before removing this checkout.",
            },
            resources: [
              {
                kind: "worktree",
                state: "retained",
                value: "/repo/saved-directory",
                nextAction: "Stop the native session before removing this checkout.",
              },
            ],
          },
        ],
      },
    ],
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
    expect(view.queryByRole("list", { name: "Session startup steps" })).toBeNull();
    expect(view.getByText("Keep this checkout until Stop succeeds.")).toBeDefined();
    expect(view.getByText("Stop unused native fork failed.")).toBeDefined();
    expect(
      view.getAllByText("Stop the native session before removing this checkout.").length,
    ).toBeGreaterThan(0);
    expect(view.getByText("/repo/saved-directory")).toBeDefined();
    fireEvent.click(view.getByRole("button", { name: "Inspect saved session" }));
    expect(view.getByText("saved-draft")).toBeDefined();
    expect(view.queryByRole("button", { name: "Open session" })).toBeNull();
    expect(view.queryByRole("button", { name: /retry|start again/i })).toBeNull();
  } finally {
    view.unmount();
  }
});
