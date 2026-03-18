import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

let branchSyncDegraded = false;
let isSwitchingWorkspace = false;
let activeBranchName = "main";

mock.module("@/state", () => ({
  useWorkspaceState: () => ({
    activeRepo: "/repo",
    branches: [
      {
        name: "main",
        isCurrent: true,
        isRemote: false,
      },
    ],
    activeBranch: {
      name: activeBranchName,
      detached: false,
    },
    isSwitchingWorkspace,
    isLoadingBranches: false,
    isSwitchingBranch: false,
    branchSyncDegraded,
    switchBranch: async () => {},
  }),
}));

mock.module("@/components/features/repository/branch-selector", () => ({
  BranchSelector: ({ value, disabled }: { value: string; disabled?: boolean }) => (
    <div data-branch-value={value} data-disabled={disabled ? "true" : "false"} />
  ),
}));

describe("BranchSwitcher", () => {
  test("shows degraded sync status when branch probe failures are active", async () => {
    branchSyncDegraded = true;
    isSwitchingWorkspace = false;
    const { BranchSwitcher } = await import("./branch-switcher");
    const html = renderToStaticMarkup(createElement(BranchSwitcher));

    expect(html).toContain("Branch sync degraded. Auto-refresh may be stale.");
  });

  test("hides degraded sync status when branch probe health is restored", async () => {
    branchSyncDegraded = false;
    isSwitchingWorkspace = false;
    const { BranchSwitcher } = await import("./branch-switcher");
    const html = renderToStaticMarkup(createElement(BranchSwitcher));

    expect(html).not.toContain("Branch sync degraded. Auto-refresh may be stale.");
  });

  test("disables branch selection while switching repositories", async () => {
    branchSyncDegraded = false;
    isSwitchingWorkspace = true;
    activeBranchName = "main";
    const { BranchSwitcher } = await import("./branch-switcher");
    const html = renderToStaticMarkup(createElement(BranchSwitcher));

    expect(html).toContain('data-disabled="true"');
  });

  test("uses the active branch name on the first render", async () => {
    branchSyncDegraded = false;
    isSwitchingWorkspace = false;
    activeBranchName = "feature/desloppify";
    const { BranchSwitcher } = await import("./branch-switcher");
    const html = renderToStaticMarkup(createElement(BranchSwitcher));

    expect(html).toContain('data-branch-value="feature/desloppify"');
  });
});
