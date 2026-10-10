import { describe, expect, mock, test } from "bun:test";
import { runTaskWorkflowAction } from "./run-task-workflow-action";

type WorkflowCallbacks = Parameters<typeof runTaskWorkflowAction>[2];

const makeWorkflowCallbacks = (overrides: Partial<WorkflowCallbacks> = {}): WorkflowCallbacks => ({
  onPlan: undefined,
  onQaStart: undefined,
  onQaOpen: undefined,
  onBuild: undefined,
  onOpenSession: undefined,
  onDelegate: undefined,
  onHumanApprove: undefined,
  onHumanRequestChanges: undefined,
  onResetImplementation: undefined,
  ...overrides,
});
describe("runTaskWorkflowAction", () => {
  test("routes workflow actions to matching callbacks", () => {
    const onPlan = mock(() => {});
    const onQaStart = mock(() => {});
    const onQaOpen = mock(() => {});
    const onBuild = mock(() => {});
    const onOpenSession = mock(() => {});
    const onDelegate = mock(() => {});
    const onHumanApprove = mock(() => {});
    const onHumanRequestChanges = mock(() => {});
    const onResetImplementation = mock(() => {});
    const onResetTask = mock(() => {});
    const onCloseTask = mock(() => {});

    runTaskWorkflowAction("set_spec", "T-1", {
      onPlan,
      onQaStart,
      onQaOpen,
      onBuild,
      onOpenSession,
      onDelegate,
      onHumanApprove,
      onHumanRequestChanges,
      onResetImplementation,
    });
    runTaskWorkflowAction("open_builder", "T-1", {
      onPlan,
      onQaStart,
      onQaOpen,
      onBuild,
      onOpenSession,
      onDelegate,
      onHumanApprove,
      onHumanRequestChanges,
      onResetImplementation,
    });

    expect(onPlan).toHaveBeenCalledWith("T-1", "set_spec");
    expect(onOpenSession).toHaveBeenCalledWith("T-1", "build", undefined);
    expect(onBuild).not.toHaveBeenCalled();

    runTaskWorkflowAction("open_spec", "T-1", {
      onPlan,
      onQaStart,
      onQaOpen,
      onBuild,
      onOpenSession,
      onDelegate,
      onHumanApprove,
      onHumanRequestChanges,
      onResetImplementation,
    });
    runTaskWorkflowAction("open_planner", "T-1", {
      onPlan,
      onQaStart,
      onQaOpen,
      onBuild,
      onOpenSession,
      onDelegate,
      onHumanApprove,
      onHumanRequestChanges,
      onResetImplementation,
    });
    expect(onOpenSession).toHaveBeenCalledWith("T-1", "spec", undefined);
    expect(onOpenSession).toHaveBeenCalledWith("T-1", "planner", undefined);

    runTaskWorkflowAction("set_plan", null, {
      onPlan,
      onQaStart,
      onQaOpen,
      onBuild,
      onOpenSession,
      onDelegate,
      onHumanApprove,
      onHumanRequestChanges,
      onResetImplementation,
    });
    expect(onPlan).toHaveBeenCalledTimes(1);

    runTaskWorkflowAction("qa_start", "T-1", {
      onPlan,
      onQaStart,
      onQaOpen,
      onBuild,
      onOpenSession,
      onDelegate,
      onHumanApprove,
      onHumanRequestChanges,
      onResetImplementation,
    });
    expect(onQaStart).toHaveBeenCalledWith("T-1");

    runTaskWorkflowAction("open_qa", "T-1", {
      onPlan,
      onQaStart,
      onQaOpen,
      onBuild,
      onOpenSession,
      onDelegate,
      onHumanApprove,
      onHumanRequestChanges,
      onResetImplementation,
    });
    expect(onOpenSession).toHaveBeenCalledWith("T-1", "qa", undefined);
    expect(onQaOpen).not.toHaveBeenCalled();

    runTaskWorkflowAction("reset_implementation", "T-1", {
      onPlan,
      onQaStart,
      onQaOpen,
      onBuild,
      onOpenSession,
      onDelegate,
      onHumanApprove,
      onHumanRequestChanges,
      onResetImplementation,
    });
    expect(onResetImplementation).toHaveBeenCalledWith("T-1", {
      closeDetailsAfterReset: true,
    });

    runTaskWorkflowAction("reset_task", "T-1", makeWorkflowCallbacks({ onResetTask }));
    runTaskWorkflowAction("close_task", "T-1", makeWorkflowCallbacks({ onCloseTask }));

    expect(onResetTask).toHaveBeenCalledWith("T-1");
    expect(onCloseTask).toHaveBeenCalledWith("T-1");
  });
  test("falls back to opening QA when no shared session opener exists", () => {
    const onQaOpen = mock(() => {});
    const onBuild = mock(() => {});

    runTaskWorkflowAction("open_qa", "T-1", makeWorkflowCallbacks({ onQaOpen, onBuild }));

    expect(onQaOpen).toHaveBeenCalledWith("T-1");
    expect(onBuild).not.toHaveBeenCalled();
  });

  test("falls back to starting builder when no shared session opener exists", () => {
    const onQaOpen = mock(() => {});
    const onBuild = mock(() => {});

    runTaskWorkflowAction("open_builder", "T-1", makeWorkflowCallbacks({ onQaOpen, onBuild }));

    expect(onBuild).toHaveBeenCalledWith("T-1");
    expect(onQaOpen).not.toHaveBeenCalled();
  });

  test("forwards role-specific session options to onOpenSession", () => {
    const onOpenSession = mock(() => {});

    runTaskWorkflowAction(
      "open_builder",
      "T-1",
      {
        onPlan: undefined,
        onQaStart: undefined,
        onQaOpen: undefined,
        onBuild: undefined,
        onOpenSession,
        onDelegate: undefined,
        onHumanApprove: undefined,
        onHumanRequestChanges: undefined,
        onResetImplementation: undefined,
      },
      {
        resolveSessionOptions: (role) =>
          role === "build"
            ? {
                session: {
                  externalSessionId: "session-build",
                  runtimeKind: "opencode",
                  workingDirectory: "/repo/worktrees/build",
                },
              }
            : undefined,
      },
    );

    expect(onOpenSession).toHaveBeenCalledWith("T-1", "build", {
      session: {
        externalSessionId: "session-build",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktrees/build",
      },
    });
  });
});
