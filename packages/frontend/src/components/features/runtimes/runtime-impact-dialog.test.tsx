import { describe, expect, test } from "bun:test";
import type { RuntimeLifecycleImpact, RuntimeLifecycleSessionImpact } from "@openducktor/contracts";
import { render, within } from "@testing-library/react";
import { RuntimeImpactDialog } from "./runtime-impact-dialog";

const session = (
  externalSessionId: string,
  overrides: Partial<RuntimeLifecycleSessionImpact> = {},
): RuntimeLifecycleSessionImpact => ({
  ref: {
    repoPath: "/repo-a",
    runtimeKind: "claude",
    workingDirectory: "/worktrees/task-1",
    externalSessionId,
  },
  title: externalSessionId,
  activity: "running",
  pendingInputCount: 0,
  ...overrides,
});

const impact = (sessions: RuntimeLifecycleSessionImpact[]): RuntimeLifecycleImpact => ({
  kinds: [],
  workspaces: [
    { workspaceId: "workspace-a", workspaceName: "Repo A", repoPath: "/repo-a", sessions },
  ],
  confirmation: "confirm-1",
});

describe("RuntimeImpactDialog", () => {
  test("shows a session that waits on background tasks as Running in the Background style", () => {
    const view = render(
      <RuntimeImpactDialog
        open
        title="Restart Claude Code"
        confirmLabel="Restart"
        impact={impact([
          session("Writing a reply"),
          session("Waiting on tasks", { waitingOnBackground: true }),
        ])}
        isLoadingImpact={false}
        impactError={null}
        isPending={false}
        error={null}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    const [working, waiting] = view.getAllByTestId("runtime-impact-session");
    expect(within(working!).getByText("Running")).toBeTruthy();
    const badge = within(waiting!).getByText("Running");
    expect(badge.getAttribute("title")).toBe("Running and waiting on background tasks");
    expect(badge.className).toContain("bg-pending-surface");
    expect(badge.querySelector(".lucide-hourglass")).not.toBeNull();
  });
});
