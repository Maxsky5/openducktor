import { describe, expect, test } from "bun:test";
import type { WorkspaceRecord } from "@openducktor/contracts";
import { resolveWorkspaceSelection } from "./workspace-selection-model";

const workspace = (workspaceId: string, isActive = false): WorkspaceRecord => ({
  workspaceId,
  workspaceName: workspaceId.toUpperCase(),
  abbreviation: null,
  tileColor: null,
  repoPath: `/repos/${workspaceId}`,
  isActive,
  hasConfig: true,
  configuredWorktreeBasePath: null,
  defaultWorktreeBasePath: null,
  effectiveWorktreeBasePath: null,
});

describe("workspace selection", () => {
  test("keeps the stored choice while the workspace is open", () => {
    const list = [workspace("a", true), workspace("b")];
    expect(resolveWorkspaceSelection("b", list)).toEqual({
      workspace: list[1] ?? null,
      replaced: null,
    });
  });

  test("starts at the host active workspace without a stored choice", () => {
    const list = [workspace("a"), workspace("b", true)];
    expect(resolveWorkspaceSelection(null, list).workspace?.workspaceId).toBe("b");
  });

  test("selects the first open workspace and reports why when the stored one closed", () => {
    const list = [workspace("a"), workspace("b", true)];
    expect(resolveWorkspaceSelection("gone", list)).toEqual({
      workspace: list[0] ?? null,
      replaced: { previousWorkspaceId: "gone" },
    });
  });

  test("selects nothing when the host has no open workspace", () => {
    expect(resolveWorkspaceSelection("a", [])).toEqual({
      workspace: null,
      replaced: { previousWorkspaceId: "a" },
    });
    expect(resolveWorkspaceSelection(null, [])).toEqual({ workspace: null, replaced: null });
  });
});
