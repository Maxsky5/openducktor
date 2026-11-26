import { expect, test } from "bun:test";
import type { AgentSessionControlSummary, StartupOperationSnapshot } from "@openducktor/contracts";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router";
import { observeStartupPreparation } from "@openducktor/frontend-core/sessions/startup/startup-prepared-handoff";
import { createStartupLiveSourceFake } from "@openducktor/frontend-core/test-support/startup-live-source-fake";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { QueryProvider } from "@/test-utils/query-provider";
import { WorkspacePreviewTransitionGuardProvider } from "@/components/layout/workspace-preview-transition-guard";
import { WorkspaceStateContext } from "@/state/app-state-contexts";
import {
  createWorkspaceRecordFixture,
  createWorkspaceStateFixture,
} from "@/test-utils/shared-test-fixtures";
import { REVEAL_ELEMENT_EVENT } from "@/lib/reveal-element";
import { InlineStartup } from "./inline-session-startup";

async function setup({
  holdPreparedPublication = false,
  steps = [],
  role = "build",
  roleLabel = "Builder",
}: {
  holdPreparedPublication?: boolean;
  steps?: StartupOperationSnapshot["steps"];
  role?: string;
  roleLabel?: string;
} = {}) {
  const connection = createTestClientConnection({ scheduleTask: () => () => {} });
  const runtimeSession: AgentSessionControlSummary = {
    externalSessionId: "native-session",
    runtimeKind: "codex",
    workingDirectory: "/repo/worktree",
    startedAt: "2026-10-27T00:00:00.000Z",
    status: "idle",
  };
  const workspace = createWorkspaceRecordFixture({ workspaceId: "workspace", repoPath: "/repo" });
  const live = createStartupLiveSourceFake(connection.queryClient, { holdPreparedPublication });
  const origin = {
    workspaceId: "workspace",
    repoPath: "/repo",
    scope: { kind: "task" as const, taskId: "task", role },
  };
  const id = connection.startupAttempts.begin({
    origin,
    label: `Start ${roleLabel} session`,
    roleLabel,
    presentation: "inline",
  });
  await observeStartupPreparation(connection.queryClient, origin.repoPath, id);
  await connection.startupAttempts.operation(id, async (context) => ({
    startupProgress: {
      ...live.prepared({
        ...origin,
        context,
        ownership: {
          state: "saved",
          target: {
            kind: "task",
            runtimeSession,
            record: {
              ...runtimeSession,
              role,
              selectedModel: null,
            },
          },
        },
      }),
      steps,
    },
  }));
  const buildElement = ({
    strictMode = false,
    paneKey,
  }: { strictMode?: boolean; paneKey?: string } = {}) => {
    const content = (
      <InlineStartup scope={{ kind: "task", repoPath: "/repo", taskId: "task", role }} />
    );
    const tree = (
      <MemoryRouter>
        <QueryProvider connection={connection}>
          <WorkspaceStateContext
            value={createWorkspaceStateFixture({
              activeWorkspace: workspace,
              workspaces: [workspace],
            })}
          >
            <WorkspacePreviewTransitionGuardProvider>
              {paneKey !== undefined ? <div key={paneKey}>{content}</div> : content}
            </WorkspacePreviewTransitionGuardProvider>
          </WorkspaceStateContext>
        </QueryProvider>
      </MemoryRouter>
    );
    return strictMode ? <StrictMode>{tree}</StrictMode> : tree;
  };
  return {
    connection,
    id,
    live,
    element: buildElement,
    render: (options?: { strictMode?: boolean; paneKey?: string }) => render(buildElement(options)),
    dispose: async () => {
      live.dispose();
      await connection.dispose();
    },
  };
}

test("starts expanded while pending, auto-collapses on clean ready, and releases on leave", async () => {
  const h = await setup({
    holdPreparedPublication: true,
    steps: [
      { id: "checkout", label: "Use current checkout", state: "completed", details: [] },
      { id: "prepare", label: "Start session", state: "running", details: [] },
    ],
  });
  const view = h.render();
  try {
    expect(view.getByRole("list", { name: "Session startup steps" })).toBeDefined();
    expect(view.getByText("Use current checkout")).toBeDefined();
    expect(view.getByText("1/2")).toBeDefined();
    await act(async () => {
      h.live.publishPrepared();
      await h.connection.startupAttempts.complete(h.id);
    });
    expect(h.connection.startupAttempts.getAttempt(h.id)?.status.phase).toBe("ready");
    const trigger = view.getByRole("button", { name: /^Builder session ready\./ });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(view.queryByRole("list", { name: "Session startup steps" })).toBeNull();
    fireEvent.click(view.getByText("Builder session ready"));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(view.getByRole("list", { name: "Session startup steps" })).toBeDefined();
    view.unmount();
    await waitFor(() => expect(h.connection.startupAttempts.getAttempt(h.id)).toBeNull());
  } finally {
    view.unmount();
    await h.dispose();
  }
});

test("keeps a ready trace visible across StrictMode remounts and same-commit owner handoffs", async () => {
  const h = await setup({
    steps: [
      { id: "checkout", label: "Use current checkout", state: "completed", details: [] },
      { id: "prepare", label: "Start session", state: "completed", details: [] },
    ],
  });
  await h.connection.startupAttempts.complete(h.id);
  const view = h.render({ strictMode: true, paneKey: "unbound" });
  try {
    await act(async () => {});
    expect(h.connection.startupAttempts.getAttempt(h.id)).not.toBeNull();
    expect(view.getByRole("button", { name: /^Builder session ready\./ })).toBeDefined();

    // Simulates ThreadPane remounting when externalSessionId arrives for the same saved session.
    view.rerender(h.element({ strictMode: true, paneKey: "bound" }));
    await act(async () => {});
    expect(h.connection.startupAttempts.getAttempt(h.id)).not.toBeNull();
    const trigger = view.getByRole("button", { name: /^Builder session ready\./ });
    expect(trigger).toBeDefined();
    // Subsequent mounts for the same attempt skip the entrance animation to avoid handoff blink.
    expect(trigger.closest(".inline-startup-enter")).toBeNull();
  } finally {
    view.unmount();
    await h.dispose();
  }
});

test.each([
  ["build", "Builder"],
  ["author", "Writer"],
] as const)(
  "keeps an inspectable %s trace expanded when a prepared session has an asynchronous action failure",
  async (role, roleLabel) => {
    const h = await setup({
      role,
      roleLabel,
      steps: [
        {
          id: "checkout",
          label: "Create worktree",
          state: "completed",
          details: [],
          resources: [{ kind: "worktree", value: "/repo/worktree", state: "created" }],
        },
        {
          id: "setup",
          label: "Run setup",
          state: "completed",
          details: [],
          action: {
            actionId: "setup",
            command: "bun install",
            waitBeforeAgentStart: false,
            result: {
              type: "exited",
              exitCode: 0,
              signal: "SIGTERM",
              outputTail: ["Setup stopped."],
            },
          },
        },
        { id: "copies", label: "Copy configured files", state: "completed", details: [] },
      ],
    });
    await h.connection.startupAttempts.complete(h.id);
    const view = h.render();
    try {
      expect(h.connection.startupAttempts.isReadyForHandoff(h.id)).toBe(true);
      expect(h.connection.startupAttempts.getAttempt(h.id)).not.toBeNull();
      const details = view.getByRole("button", {
        expanded: true,
        name: new RegExp(`^${roleLabel} session ready with a setup error`),
      });
      expect(details.getAttribute("aria-expanded")).toBe("true");
      expect(view.getByRole("list", { name: "Session startup steps" })).toBeDefined();
      fireEvent.click(view.getByRole("button", { name: /Run setup.*Failed/ }));
      expect(view.getByText("Command ended with signal SIGTERM.")).toBeDefined();
      expect(view.getByText("Setup stopped.")).toBeDefined();
      expect(h.connection.startupAttempts.getAttempt(h.id)).not.toBeNull();
    } finally {
      view.unmount();
      await h.dispose();
    }
  },
);

test("keeps a ready trace with a step warning expanded and visible", async () => {
  const h = await setup({
    steps: [
      {
        id: "naming",
        label: "Name branch",
        state: "completed",
        details: [],
        warning: "Branch naming model failed; used fallback branch name.",
      },
      { id: "prepare", label: "Start session", state: "completed", details: [] },
    ],
  });
  await h.connection.startupAttempts.complete(h.id);
  const view = h.render();
  try {
    const trigger = view.getByRole("button", {
      expanded: true,
      name: /^Builder session ready with a warning\./,
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(view.getByText("Branch naming model failed; used fallback branch name.")).toBeDefined();
    view.unmount();
    // Warning attempts stay retained until dismissed rather than silently clearing on leave.
    expect(h.connection.startupAttempts.getAttempt(h.id)).not.toBeNull();
  } finally {
    view.unmount();
    await h.dispose();
  }
});

test("unpins a parent transcript on expand and avoids repeating resource values or action output tails", async () => {
  const h = await setup({
    steps: [
      {
        id: "checkout",
        label: "Create workspace worktree",
        state: "completed",
        details: ["/repo/worktree", "odt/say-ok"],
        resources: [
          { kind: "worktree", value: "/repo/worktree", state: "created" },
          { kind: "branch", value: "odt/say-ok", state: "created" },
        ],
      },
      {
        id: "action:setup",
        label: "Worktree setup",
        state: "completed",
        details: ["installed 10 packages"],
        action: {
          actionId: "setup",
          command: "bun install",
          waitBeforeAgentStart: true,
          result: {
            type: "exited",
            exitCode: 0,
            signal: null,
            outputTail: ["installed 10 packages"],
          },
        },
      },
    ],
  });
  await h.connection.startupAttempts.complete(h.id);
  const view = h.render();
  let revealCount = 0;
  const onReveal = () => {
    revealCount += 1;
  };
  view.container.addEventListener(REVEAL_ELEMENT_EVENT, onReveal);
  try {
    const header = view.getByRole("button", { name: /^Builder session ready\./ });
    expect(view.queryByRole("list", { name: "Session startup steps" })).toBeNull();
    fireEvent.click(header);
    expect(revealCount).toBe(1);

    fireEvent.click(view.getByRole("button", { name: /Create workspace worktree.*Completed/ }));
    expect(revealCount).toBe(2);
    expect(view.getAllByText("/repo/worktree")).toHaveLength(1);
    expect(view.getAllByText("odt/say-ok")).toHaveLength(1);

    fireEvent.click(view.getByRole("button", { name: /Worktree setup.*Completed/ }));
    expect(revealCount).toBe(3);
    expect(view.getAllByText("installed 10 packages")).toHaveLength(1);

    // Collapsing unmounts the inline trace body so hidden content cannot leak scroll height.
    fireEvent.click(header);
    expect(view.queryByRole("list", { name: "Session startup steps" })).toBeNull();
  } finally {
    view.container.removeEventListener(REVEAL_ELEMENT_EVENT, onReveal);
    view.unmount();
    await h.dispose();
  }
});
