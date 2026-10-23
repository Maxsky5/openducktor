import { expect, test } from "bun:test";
import {
  repoConfigSchema,
  type WorkspaceSession,
  type WorkspaceSessionForkInput,
  type WorkspaceSessionForkResult,
} from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { act } from "react";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { QueryProvider } from "@/test-utils/query-provider";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { createAgentSessionsStore } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import { AgentSessionsContext } from "@openducktor/frontend-core/sessions/session-contexts";
import {
  sessionForkRequestKey,
  useSessionForkRequests,
} from "@openducktor/frontend-core/sessions/session-forks";
import { WorkspaceSessionForkDialog } from "./workspace-session-fork-dialog";

const source: WorkspaceSession = {
  id: "source",
  runtimeKind: "codex",
  externalSessionId: "native-source",
  executionTarget: {
    kind: "local_worktree",
    workingDirectory: "/worktrees/source-feature",
    branchName: "odt/source-feature",
    worktreeState: "present",
  },
  roleSnapshot: null,
  selectedModel: null,
  manualTitle: "Source",
  targetBranch: null,
  generatedTitle: null,
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
};
const identity = {
  externalSessionId: "native-source",
  runtimeKind: "codex" as const,
  workingDirectory: "/worktrees/source-feature",
};
const point = { messageId: "native-reply" };

function renderFork(
  perform: (input: WorkspaceSessionForkInput) => Promise<WorkspaceSessionForkResult>,
  record = source,
) {
  const store = createAgentSessionsStore("/repo");
  const connection = createTestClientConnection({
    client: {
      workspaceGetRepoConfig: async () =>
        repoConfigSchema.parse({
          workspaceId: "workspace",
          workspaceName: "Workspace",
          repoPath: "/repo",
          branchPrefix: "odt",
        }),
      workspaceSessionFork: perform,
    },
  });
  const completed: WorkspaceSession[] = [];
  let closed = 0;
  function Dialog() {
    const queryClient = useQueryClient();
    const pending = useSessionForkRequests(queryClient);
    return (
      <WorkspaceSessionForkDialog
        open
        workspace={{ workspaceId: "workspace", workspaceName: "Workspace", repoPath: "/repo" }}
        record={record}
        source={identity}
        point={point}
        disabledReason={null}
        pending={pending.has(sessionForkRequestKey("/repo", identity, point))}
        onClose={() => {
          closed += 1;
        }}
        onForked={(child) => {
          completed.push(child);
        }}
      />
    );
  }
  const view = render(
    <QueryProvider connection={connection}>
      <AgentSessionsContext value={store}>
        <Dialog />
      </AgentSessionsContext>
    </QueryProvider>,
  );
  return { view, completed, closed: () => closed };
}

test("fork dialog defaults to the source folder and blocks duplicate submit and close while pending", async () => {
  const calls: WorkspaceSessionForkInput[] = [];
  let reject!: (cause: Error) => void;
  const { view, completed, closed } = renderFork((input) => {
    calls.push(input);
    return new Promise((_resolve, fail) => {
      reject = fail;
    });
  });
  try {
    expect(view.getByRole("radio", { name: "Same folder" }).getAttribute("data-state")).toBe(
      "checked",
    );
    expect(view.getByText("/worktrees/source-feature")).toBeDefined();
    expect(view.getByText("source-feature")).toBeDefined();
    expect(view.getByText("odt/source-feature")).toBeDefined();
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Fork chat" }));
    });
    expect(calls).toEqual([
      {
        workspaceId: "workspace",
        sessionId: "source",
        forkPoint: point,
        destination: { kind: "same_folder" },
      },
    ]);
    expect(view.getByRole("button", { name: "Forking chat…" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(view.getByRole("radio", { name: "New worktree" }));
    expect(view.getByRole("radio", { name: "Same folder" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(view.queryByLabelText("Worktree name")).toBeNull();
    fireEvent.submit(view.getByRole("button", { name: "Forking chat…" }).closest("form")!);
    expect(view.queryByRole("button", { name: "Close" })).toBeNull();
    expect(calls).toHaveLength(1);
    expect(closed()).toBe(0);
    await act(async () => {
      reject(new Error("The source reply no longer exists. Reload history."));
    });
    expect((await view.findByRole("alert")).textContent).toContain("Reload history");
    expect(view.getByRole("button", { name: "Fork chat" }).hasAttribute("disabled")).toBe(false);
    expect(completed).toEqual([]);
  } finally {
    view.unmount();
  }
});

test("new worktree uses New chat defaults and validation and keeps inputs after a failed fork", async () => {
  const calls: WorkspaceSessionForkInput[] = [];
  let reject!: (cause: Error) => void;
  const { view, completed } = renderFork((input) => {
    calls.push(input);
    return new Promise((_resolve, fail) => {
      reject = fail;
    });
  });
  try {
    fireEvent.click(view.getByRole("radio", { name: "New worktree" }));
    const name = view.getByLabelText("Worktree name");
    expect(view.getByDisplayValue("source-feature-fork")).toBeDefined();
    const branch = view.getByLabelText("Branch name optional");
    await waitFor(() => expect(branch.getAttribute("placeholder")).toBe("odt/source-feature-fork"));
    expect(
      view.getByText("Uncommitted changes in the source folder do not go to the new worktree."),
    ).toBeDefined();
    fireEvent.change(name, { target: { value: "../escape" } });
    expect(view.getByRole("button", { name: "Fork chat" }).hasAttribute("disabled")).toBe(true);
    expect(view.getByRole("alert").textContent).toContain(
      "Use letters, numbers, hyphens, or underscores",
    );
    fireEvent.change(name, { target: { value: "retry-fork" } });
    fireEvent.change(branch, { target: { value: "feature/alternate" } });
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Fork chat" }));
    });
    expect(calls[0]?.destination).toEqual({
      kind: "new_worktree",
      name: "retry-fork",
      branchName: "feature/alternate",
    });
    expect(name.hasAttribute("disabled")).toBe(true);
    expect(branch.hasAttribute("disabled")).toBe(true);
    await act(async () => {
      reject(new Error("Claude refused the fork point. Load another reply."));
    });
    expect((await view.findByRole("alert")).textContent).toContain("Load another reply");
    expect(view.getByDisplayValue("retry-fork")).toBeDefined();
    expect(view.getByDisplayValue("feature/alternate")).toBeDefined();
    expect(view.getByRole("button", { name: "Fork chat" }).hasAttribute("disabled")).toBe(false);
    expect(completed).toEqual([]);
  } finally {
    view.unmount();
  }
});

test("a repository-root source starts with an empty worktree name", () => {
  const { view } = renderFork(
    async () => {
      throw new Error("Unexpected submit");
    },
    { ...source, executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" } },
  );
  try {
    fireEvent.click(view.getByRole("radio", { name: "New worktree" }));
    expect(view.getByLabelText("Worktree name").getAttribute("value")).toBe("");
    expect(view.getByRole("button", { name: "Fork chat" }).hasAttribute("disabled")).toBe(true);
  } finally {
    view.unmount();
  }
});
