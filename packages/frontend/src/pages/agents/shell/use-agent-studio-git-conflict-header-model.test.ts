import { describe, expect, mock, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import type { GitConflict } from "@/features/agent-studio-git";
import { enableReactActEnvironment } from "@/test-utils/react-act-environment";
import type { AgentStudioQuickActionOption } from "../agent-studio-quick-actions";
import { useAgentStudioGitConflictHeaderModel } from "./use-agent-studio-git-conflict-header-model";
import { createAgentStudioHeaderModelFixture } from "./use-agents-page-shell-model.test-support";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioGitConflictHeaderModel>[0];

const conflict: GitConflict = {
  operation: "rebase",
  currentBranch: "feature/task-1",
  targetBranch: "origin/main",
  conflictedFiles: ["src/conflict.ts"],
  output: "",
  workingDir: "/repo",
};

const gitConflictQuickAction: AgentStudioQuickActionOption = {
  id: "quick:build_rebase_conflict_resolution",
  role: "build",
  launchActionId: "build_rebase_conflict_resolution",
  label: "Resolve git conflict",
  description: "Ask Builder to resolve the active git conflict.",
  postStartAction: "send_message",
  disabled: false,
};

const workflowQuickAction: AgentStudioQuickActionOption = {
  id: "quick:qa_review",
  role: "qa",
  launchActionId: "qa_review",
  label: "Start QA review",
  description: "Open the start-session flow for QA review.",
  postStartAction: "kickoff",
  disabled: false,
};

const renderHeaderModel = (args: Partial<HookArgs> = {}) => {
  const props: HookArgs = {
    headerModel: {
      ...createAgentStudioHeaderModelFixture(),
      quickActions: [workflowQuickAction],
      primaryQuickAction: workflowQuickAction,
    },
    gitConflictQuickAction,
    gitConflict: conflict,
    resolveGitConflict: mock(async () => {}),
    isPanelOpen: true,
    ...args,
  };
  const view = renderHook(
    (hookProps: HookArgs) => useAgentStudioGitConflictHeaderModel(hookProps),
    {
      initialProps: props,
    },
  );
  return {
    props,
    current: () => view.result.current,
    rerender: (next: Partial<HookArgs>) => {
      Object.assign(props, next);
      act(() => view.rerender({ ...props }));
    },
  };
};

describe("useAgentStudioGitConflictHeaderModel", () => {
  test("puts the conflict action first while a conflict is active", () => {
    const resolveGitConflict = mock(async () => {});
    const header = renderHeaderModel({ resolveGitConflict });

    expect(header.current().quickActions).toEqual([gitConflictQuickAction, workflowQuickAction]);
    expect(header.current().primaryQuickAction).toBe(gitConflictQuickAction);
    header.current().onResolveGitConflictQuickAction?.();
    expect(resolveGitConflict).toHaveBeenCalledTimes(1);
  });

  test("keeps the workflow header without a conflict, while the panel is closed, or without Builder", () => {
    const header = renderHeaderModel({ gitConflict: null });
    const workflowHeader = { ...header.props.headerModel, onResolveGitConflictQuickAction: null };
    expect(header.current()).toEqual(workflowHeader);

    header.rerender({ gitConflict: conflict, isPanelOpen: false });
    expect(header.current()).toEqual(workflowHeader);

    header.rerender({ isPanelOpen: true, gitConflictQuickAction: null });
    expect(header.current()).toEqual(workflowHeader);
  });

  test("keeps the header model and calls the newest resolve action after a refresh", () => {
    const firstResolve = mock(async () => {});
    const header = renderHeaderModel({ resolveGitConflict: firstResolve });
    const headerModel = header.current();

    const refreshedResolve = mock(async () => {});
    header.rerender({ gitConflict: { ...conflict }, resolveGitConflict: refreshedResolve });

    expect(header.current()).toBe(headerModel);
    headerModel.onResolveGitConflictQuickAction?.();
    expect(refreshedResolve).toHaveBeenCalledTimes(1);
    expect(firstResolve).not.toHaveBeenCalled();
  });
});
