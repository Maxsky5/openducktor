import { beforeEach, describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { act } from "react";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("ForcePushDialog", () => {
  let ForcePushDialog: typeof import("./force-push-dialog")["ForcePushDialog"];

  beforeEach(async () => {
    ({ ForcePushDialog } = await import("./force-push-dialog"));
  });

  test("uses the info surface styling and body spacing for the safety content", async () => {
    const rendered = render(
      <ForcePushDialog
        pendingForcePush={{
          remote: "origin",
          branch: "feature/task-11",
          output: "non-fast-forward",
          repoPath: "/repo",
          workingDir: "/tmp/worktree",
        }}
        isPushing={false}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );

    const body = screen.getByTestId("agent-studio-git-force-push-body");
    const safetyNote = screen.getByTestId("agent-studio-git-force-push-safety-note");

    expect(body.className).toContain("space-y-4");
    expect(safetyNote.className).toContain("border-info-border");
    expect(safetyNote.className).toContain("bg-info-surface");
    expect(safetyNote.className).toContain("text-info-surface-foreground");

    await act(async () => {
      rendered.unmount();
    });
  });
});
