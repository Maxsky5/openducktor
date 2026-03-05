import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

let branchSyncDegraded = false;

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
      name: "main",
      detached: false,
    },
    isLoadingBranches: false,
    isSwitchingBranch: false,
    branchSyncDegraded,
    switchBranch: async () => {},
  }),
}));

describe("BranchSwitcher", () => {
  test("shows degraded sync status when branch probe failures are active", async () => {
    branchSyncDegraded = true;
    const { BranchSwitcher } = await import("./branch-switcher");
    const html = renderToStaticMarkup(createElement(BranchSwitcher));

    expect(html).toContain("Branch sync degraded. Auto-refresh may be stale.");
  });

  test("hides degraded sync status when branch probe health is restored", async () => {
    branchSyncDegraded = false;
    const { BranchSwitcher } = await import("./branch-switcher");
    const html = renderToStaticMarkup(createElement(BranchSwitcher));

    expect(html).not.toContain("Branch sync degraded. Auto-refresh may be stale.");
  });
});
