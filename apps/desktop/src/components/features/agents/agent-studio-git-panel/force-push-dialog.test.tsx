import { afterEach, describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { act } from "react";
import { ForcePushDialog } from "./force-push-dialog";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("ForcePushDialog", () => {
  let rendered: ReturnType<typeof render> | null = null;

  afterEach(async () => {
    if (rendered) {
      await act(async () => {
        rendered?.unmount();
      });
      rendered = null;
    }
  });

  test("uses the info surface styling and body spacing for the safety content", async () => {
    rendered = render(
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
    const leaseCode = screen.getByText("--force-with-lease");
    const forceCode = screen.getByText("--force");

    expect(body.className).toContain("space-y-4");
    expect(safetyNote.className).toContain("border-info-border");
    expect(safetyNote.className).toContain("bg-info-surface");
    expect(safetyNote.className).toContain("text-info-surface-foreground");
    expect(leaseCode.className).toContain("border-info-border");
    expect(leaseCode.className).toContain("bg-info-surface/60");
    expect(leaseCode.className).toContain("text-info-surface-foreground");
    expect(forceCode.className).toContain("border-info-border");
    expect(forceCode.className).toContain("bg-info-surface/60");
    expect(forceCode.className).toContain("text-info-surface-foreground");
  });
});
