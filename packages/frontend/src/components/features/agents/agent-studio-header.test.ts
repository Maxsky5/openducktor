import { afterEach, beforeEach, describe, expect, jest, mock, test } from "bun:test";
import type { PullRequest } from "@openducktor/contracts";
import { workflowStepRailState } from "@openducktor/frontend-core/lib/agent-workflow-state";
import { setupTestingLibraryFakeTimers } from "@openducktor/frontend-core/test-support/testing-library-fake-timers";
import { fireEvent, render, screen } from "@testing-library/react";
import { act, type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TEST_ROLE_OPTIONS } from "./agent-chat/agent-chat-test-fixtures";
import { AgentStudioHeader } from "./agent-studio-header";
import { QuickActionsMenu } from "./agent-studio-header-quick-actions";
import { WorkflowRail, WorkflowRailPreview } from "./agent-studio-header-workflow-rail";
import type { AgentWorkflowStep } from "./agent-studio-header.types";
import type { WorkflowRailStep } from "@/types/agent-workflow";
import { CLOSE_TASK_ACTION } from "@openducktor/frontend-core/tasks/workflow/core-task-actions";

const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

const immediateRequestAnimationFrame: typeof requestAnimationFrame = (
  callback: FrameRequestCallback,
): number => {
  callback(0);
  return 1;
};

beforeEach(() => {
  globalThis.requestAnimationFrame = immediateRequestAnimationFrame;
  globalThis.cancelAnimationFrame = () => {};
});

afterEach(() => {
  globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
});

const roleIcon = (index: number) => {
  const option = TEST_ROLE_OPTIONS[index];
  if (!option) {
    throw new Error(`Missing test role option at index ${index}`);
  }
  return option.icon;
};

const noPullRequest: PullRequest | null = null;

type BuiltinWorkflowFixture = Omit<
  AgentWorkflowStep,
  "id" | "hint" | "attentionVariant" | "role"
> & { role: string };

const presentWorkflowStep = (step: BuiltinWorkflowFixture): AgentWorkflowStep => ({
  ...step,
  id: step.role,
  ...workflowStepRailState({ state: step.state, hasSession: step.sessionValue !== null }),
});

const buildModel = () => ({
  taskTitle: "Rework Agent Studio UI",
  taskId: "fairnest-97f",
  pullRequest: noPullRequest,
  onOpenTaskDetails: () => {},
  selectedRole: "spec" as const,
  workflowSteps: [
    {
      role: "spec" as const,
      label: "Spec",
      icon: roleIcon(0),
      state: {
        tone: "in_progress" as const,
        availability: "available" as const,
        completion: "in_progress" as const,
        liveSession: "running" as const,
        waitingOnBackground: false,
      },
      sessionValue: "spec-session",
    },
    {
      role: "planner" as const,
      label: "Planner",
      icon: roleIcon(1),
      state: {
        tone: "done" as const,
        availability: "available" as const,
        completion: "done" as const,
        liveSession: "idle" as const,
        waitingOnBackground: false,
      },
      sessionValue: "planner-session",
    },
    {
      role: "build" as const,
      label: "Builder",
      icon: roleIcon(2),
      state: {
        tone: "available" as const,
        availability: "available" as const,
        completion: "not_started" as const,
        liveSession: "none" as const,
        waitingOnBackground: false,
      },
      sessionValue: null,
    },
    {
      role: "qa" as const,
      label: "QA",
      icon: roleIcon(3),
      state: {
        tone: "optional" as const,
        availability: "optional" as const,
        completion: "not_started" as const,
        liveSession: "none" as const,
        waitingOnBackground: false,
      },
      sessionValue: null,
    },
  ].map(presentWorkflowStep),
  onWorkflowStepSelect: () => {},
  sessionSelector: {
    value: "spec-session",
    groups: [
      {
        label: "Spec",
        options: [
          {
            value: "spec-session",
            label: "Spec Revision · Spec",
            description: "Today · idle",
          },
        ],
      },
    ],
    disabled: false,
    onValueChange: () => {},
    shouldAutofocusComposerForValue: () => true,
  },
  sessionCreateOptions: [
    {
      id: "build:build_implementation_start:message_first",
      role: "build" as const,
      launchActionId: "build_implementation_start" as const,
      label: "Prepare Builder session",
      description: "Open a Builder composer without sending a kickoff.",
    },
  ],
  onPrepareMessageFirstSession: () => {},
  quickActions: [
    {
      kind: "session_start" as const,
      id: "quick:build_implementation_start",
      role: "build" as const,
      launchActionId: "build_implementation_start" as const,
      label: "Start Implementation",
      description: "Open the start-session flow for Builder implementation work.",
      postStartAction: "kickoff" as const,
      disabled: false,
    },
    {
      kind: "session_start" as const,
      id: "quick:pull_request",
      role: "build" as const,
      launchActionId: "pull_request" as const,
      label: "Generate Pull Request",
      description: "Reuse or fork a Builder session to create or update a pull request.",
      postStartAction: "kickoff" as const,
      disabled: true,
      disabledReason: "Requires an existing Builder session.",
    },
  ],
  primaryQuickAction: {
    kind: "session_start" as const,
    id: "quick:build_implementation_start",
    role: "build" as const,
    launchActionId: "build_implementation_start" as const,
    label: "Start Implementation",
    description: "Open the start-session flow for Builder implementation work.",
    postStartAction: "kickoff" as const,
    disabled: false,
  },
  onQuickAction: () => {},
  onResolveGitConflictQuickAction: null,
  isCreatingSession: false,
  stats: {
    sessions: 3,
    messages: 12,
    permissions: 1,
    questions: 2,
  },
  agentStudioReady: true,
});

const renderWorkflow = (
  props: Partial<Omit<ComponentProps<typeof WorkflowRail>, "steps">> & {
    steps?: BuiltinWorkflowFixture[];
  } = {},
) => {
  const model = buildModel();
  return renderToStaticMarkup(
    createElement(WorkflowRail, {
      selectedStepId: model.selectedRole,
      disabled: !model.agentStudioReady,
      onStepSelect: model.onWorkflowStepSelect,
      ...props,
      steps: props.steps ? props.steps.map(presentWorkflowStep) : model.workflowSteps,
    }),
  );
};

describe("AgentStudioHeader", () => {
  setupTestingLibraryFakeTimers();

  afterEach(async () => {
    // The popovers restore focus on a timer after they close.
    await act(async () => jest.advanceTimersByTime(0));
  });

  test("renders the task title and session controls", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioHeader, {
        repoActions: null,
        viewControls: null,
        openIn: null,
        model: buildModel(),
      }),
    );

    expect(html).toContain("Rework Agent Studio UI");
    expect(html).toContain("fairnest-97f");
    expect(html).toContain('aria-label="Open task details"');
    expect(html).toMatch(/aria-label="Session history[^"]*"/);
    expect(html).toContain('aria-label="Open quick actions menu"');
    expect(html).not.toContain("Viewing Session");
    expect(html).not.toContain("Sessions:");
    expect(html).not.toContain("Messages:");
    expect(html).not.toContain("Permissions:");
    expect(html).not.toContain("Questions:");
    expect(html).not.toContain("Chat-first workspace for this task session.");
    expect(html).not.toContain("AGENT STUDIO");
  });

  test("shows the linked pull request link in the top bar", () => {
    const pullRequest: PullRequest = {
      providerId: "github",
      number: 110,
      url: "https://github.com/openai/openducktor/pull/110",
      state: "open",
      createdAt: "2026-03-12T12:24:09Z",
      updatedAt: "2026-03-12T12:24:09Z",
    };
    const withLink = renderToStaticMarkup(
      createElement(AgentStudioHeader, {
        repoActions: null,
        viewControls: null,
        openIn: null,
        model: { ...buildModel(), pullRequest },
      }),
    );
    const withoutLink = renderToStaticMarkup(
      createElement(AgentStudioHeader, {
        repoActions: null,
        viewControls: null,
        openIn: null,
        model: buildModel(),
      }),
    );

    expect(withLink.match(/PR #110/g)?.length).toBe(1);
    expect(withoutLink).not.toContain("PR #");
  });

  test("falls back to generic header title when task title is missing", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioHeader, {
        repoActions: null,
        viewControls: null,
        openIn: null,
        model: {
          ...buildModel(),
          taskTitle: null,
        },
      }),
    );

    expect(html).toContain("Task session");
  });

  test("opens task details from the title and shows the full title and ID in its tooltip", async () => {
    const model = buildModel();
    const onOpenTaskDetails = mock(() => {});
    const view = render(
      createElement(AgentStudioHeader, {
        repoActions: null,
        viewControls: null,
        openIn: null,
        model: { ...model, onOpenTaskDetails },
      }),
    );
    try {
      const trigger = view.getByRole("button", { name: "Open task details" });
      await act(async () => trigger.focus());
      const tooltip = view.getByRole("tooltip");
      expect(tooltip.textContent).toContain(model.taskTitle);
      expect(tooltip.textContent).toContain(model.taskId);
      await act(async () => fireEvent.click(trigger));
      expect(onOpenTaskDetails).toHaveBeenCalledTimes(1);
    } finally {
      view.unmount();
    }
  });

  test("shows the selected session in the history tooltip", async () => {
    const view = render(
      createElement(AgentStudioHeader, {
        repoActions: null,
        viewControls: null,
        openIn: null,
        model: buildModel(),
      }),
    );
    try {
      const trigger = view.getByRole("button", {
        name: "Session history, selected Spec Revision · Spec",
      });
      await act(async () => trigger.focus());
      expect(view.getByRole("tooltip").textContent).toBe("Session history · Spec Revision · Spec");
    } finally {
      view.unmount();
    }
  });

  test("closes session history menu without changing selection when the current session is chosen again", async () => {
    const onValueChange = mock(() => {});
    const model = buildModel();

    render(
      createElement(AgentStudioHeader, {
        repoActions: null,
        viewControls: null,
        openIn: null,
        model: {
          ...model,
          sessionSelector: {
            ...model.sessionSelector,
            onValueChange,
          },
        },
      }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Session history/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Spec Revision · Spec"));
    });

    expect(onValueChange).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText(/Search sessions/i)).toBeNull();
  });

  test.each([
    { session: "an interactive session", restoreFocus: false },
    { session: "a read-only session", restoreFocus: true },
  ])("selects $session and restores trigger focus=$restoreFocus", async ({ restoreFocus }) => {
    const model = buildModel();
    const onValueChange = mock((_value: string) => {});
    render(
      createElement(AgentStudioHeader, {
        repoActions: null,
        viewControls: null,
        openIn: null,
        model: {
          ...model,
          sessionSelector: {
            ...model.sessionSelector,
            groups: [
              ...model.sessionSelector.groups,
              {
                label: "Build sessions",
                options: [
                  {
                    value: "build-session",
                    label: "Builder Draft · Build",
                    description: "Today · running",
                  },
                ],
              },
            ],
            onValueChange,
            shouldAutofocusComposerForValue: () => !restoreFocus,
          },
        },
      }),
    );

    const trigger = screen.getByRole("button", { name: /Session history/i });
    await act(async () => fireEvent.click(trigger));
    expect(screen.getByPlaceholderText(/Search sessions/i)).toBeTruthy();
    expect(screen.getByText("Spec")).toBeTruthy();
    expect(screen.getByText("Build sessions")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByText("Builder Draft · Build")));
    await act(async () => jest.advanceTimersByTime(0));

    expect(onValueChange.mock.calls).toEqual([["build-session"]]);
    expect(screen.queryByPlaceholderText(/Search sessions/i) === null).toBe(true);
    expect(document.activeElement === trigger).toBe(restoreFocus);
  });

  test("opens quick-actions menu and selects message-first role", async () => {
    const onPrepareMessageFirstSession = mock(() => {});
    render(
      createElement(AgentStudioHeader, {
        repoActions: null,
        viewControls: null,
        openIn: null,
        model: {
          ...buildModel(),
          onPrepareMessageFirstSession,
        },
      }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Open quick actions menu/i }));
    });
    expect(screen.getByText("Prepare Builder session")).toBeTruthy();
    expect(screen.getByText("Open a Builder composer without sending a kickoff.")).toBeTruthy();
    expect(document.querySelector(".lucide-message-circle-plus")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText("Open a Builder composer without sending a kickoff."));
    });

    expect(onPrepareMessageFirstSession).toHaveBeenCalledWith(
      expect.objectContaining({ role: "build", launchActionId: "build_implementation_start" }),
    );
  });

  test("runs the primary quick action from the main split button", async () => {
    const onQuickAction = mock(() => {});
    render(
      createElement(AgentStudioHeader, {
        repoActions: null,
        viewControls: null,
        openIn: null,
        model: {
          ...buildModel(),
          onQuickAction,
        },
      }),
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Run quick action: Start Implementation/i }),
      );
    });

    expect(onQuickAction).toHaveBeenCalledWith(
      expect.objectContaining({ role: "build", launchActionId: "build_implementation_start" }),
    );
  });

  test("opens quick-actions menu grouped by role with disabled reasons", async () => {
    const onQuickAction = mock(() => {});
    render(
      createElement(AgentStudioHeader, {
        repoActions: null,
        viewControls: null,
        openIn: null,
        model: {
          ...buildModel(),
          sessionCreateOptions: [
            {
              id: "spec:spec_initial:message_first",
              role: "spec" as const,
              launchActionId: "spec_initial" as const,
              label: "Prepare Spec session",
              description: "Open a Spec composer without sending a kickoff.",
            },
            {
              id: "planner:planner_initial:message_first",
              role: "planner" as const,
              launchActionId: "planner_initial" as const,
              label: "Prepare Planner session",
              description: "Open a Planner composer without sending a kickoff.",
            },
            {
              id: "qa:qa_review:message_first",
              role: "qa" as const,
              launchActionId: "qa_review" as const,
              label: "Prepare QA session",
              description: "Open a QA composer without sending a kickoff.",
            },
          ],
          onQuickAction,
        },
      }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Open quick actions menu/i }));
    });

    const groupHeadings = Array.from(document.querySelectorAll("[cmdk-group-heading]")).map(
      (element) => element.textContent,
    );
    expect(groupHeadings).toEqual(["Spec", "Planner", "Builder", "QA"]);
    expect(screen.queryByText("Primary")).toBeNull();
    expect(screen.queryByText("More actions")).toBeNull();
    expect(screen.getByText("Generate Pull Request")).toBeTruthy();
    expect(screen.getByText("Requires an existing Builder session.")).toBeTruthy();
    expect(screen.getByText("Prepare Spec session")).toBeTruthy();

    await act(async () => {
      fireEvent.click(
        screen.getByText("Open the start-session flow for Builder implementation work."),
      );
    });

    expect(onQuickAction).toHaveBeenCalledWith(
      expect.objectContaining({ role: "build", launchActionId: "build_implementation_start" }),
    );
  });

  test("keeps Approve Task reachable when the pull request action lacks a Builder session", async () => {
    const onQuickAction = mock(() => {});
    const unavailablePullRequest = {
      kind: "session_start" as const,
      id: "quick:pull_request",
      role: "build" as const,
      launchActionId: "pull_request" as const,
      label: "Generate Pull Request",
      postStartAction: "kickoff" as const,
      disabled: true,
      disabledReason: "Requires an existing Builder session.",
    };
    const approveTask = {
      kind: "task_action" as const,
      id: "task:human_approve",
      taskAction: { kind: "workflow" as const, action: "human_approve" },
      placement: "trailing" as const,
      label: "Approve Task",
      description: "Open the approval flow to merge, open a pull request, or close the task.",
      disabled: false,
    };
    render(
      createElement(AgentStudioHeader, {
        repoActions: null,
        viewControls: null,
        openIn: null,
        model: {
          ...buildModel(),
          sessionCreateOptions: [],
          quickActions: [unavailablePullRequest, approveTask],
          primaryQuickAction: unavailablePullRequest,
          onQuickAction,
        },
      }),
    );

    const primary = screen.getByRole<HTMLButtonElement>("button", {
      name: /Run quick action: Generate Pull Request/i,
    });
    expect(primary.disabled).toBe(true);
    const menuTrigger = screen.getByRole<HTMLButtonElement>("button", {
      name: /Open quick actions menu/i,
    });
    expect(menuTrigger.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(menuTrigger);
    });
    await act(async () => fireEvent.click(screen.getByText("Approve Task")));
    await act(async () => jest.advanceTimersByTime(0));

    expect(document.activeElement === menuTrigger).toBe(true);
    expect(onQuickAction).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "task_action",
        taskAction: { kind: "workflow", action: "human_approve" },
      }),
    );
  });

  test("keeps the merged marker while the git conflict action leads", () => {
    const resolveConflict = {
      kind: "session_start" as const,
      id: "quick:build_rebase_conflict_resolution",
      role: "build" as const,
      launchActionId: "build_rebase_conflict_resolution" as const,
      surface: "git_conflict" as const,
      label: "Resolve Git Conflict",
      description: "Ask Builder to resolve the active git conflict.",
      postStartAction: "send_message" as const,
      disabled: false,
    };
    const closeTask = {
      kind: "task_action" as const,
      id: "task:close_task",
      taskAction: { kind: "core" as const, action: CLOSE_TASK_ACTION },
      placement: "leading" as const,
      label: "Close Task",
      description: "The task branch is merged into origin/main.",
      mergedTarget: "origin/main",
      disabled: false,
    };
    render(
      createElement(AgentStudioHeader, {
        repoActions: null,
        viewControls: null,
        openIn: null,
        model: {
          ...buildModel(),
          quickActions: [resolveConflict, closeTask],
          primaryQuickAction: resolveConflict,
          onResolveGitConflictQuickAction: () => {},
        },
      }),
    );

    expect(screen.getByTestId("agent-studio-merged-marker").textContent).toContain(
      "Merged into origin/main",
    );
  });

  test("keeps the quick-actions menu closed when every action is disabled", () => {
    const unavailablePullRequest = {
      kind: "session_start" as const,
      id: "quick:pull_request",
      role: "build" as const,
      launchActionId: "pull_request" as const,
      label: "Generate Pull Request",
      postStartAction: "kickoff" as const,
      disabled: true,
      disabledReason: "Requires an existing Builder session.",
    };
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(AgentStudioHeader, {
          repoActions: null,
          viewControls: null,
          openIn: null,
          model: {
            ...buildModel(),
            sessionCreateOptions: [],
            quickActions: [unavailablePullRequest],
            primaryQuickAction: unavailablePullRequest,
          },
        }),
      ),
    );

    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Open quick actions menu"/);
  });

  test("renders the wider quick-actions popover with the taller result list", async () => {
    const { unmount } = render(
      createElement(AgentStudioHeader, {
        repoActions: null,
        viewControls: null,
        openIn: null,
        model: {
          ...buildModel(),
          quickActions: [
            {
              kind: "session_start" as const,
              id: "quick:build_implementation_start",
              role: "build" as const,
              launchActionId: "build_implementation_start" as const,
              label: "Start Implementation",
              description: "Open the start-session flow for Builder implementation work.",
              postStartAction: "kickoff" as const,
              disabled: false,
            },
          ],
          sessionCreateOptions: [],
          primaryQuickAction: {
            kind: "session_start" as const,
            id: "quick:build_implementation_start",
            role: "build" as const,
            launchActionId: "build_implementation_start" as const,
            label: "Start Implementation",
            description: "Open the start-session flow for Builder implementation work.",
            postStartAction: "kickoff" as const,
            disabled: false,
          },
        },
      }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Open quick actions menu/i }));
    });

    const popoverContent = document.querySelector<HTMLElement>('[data-slot="popover-content"]');
    const commandList = document.querySelector<HTMLElement>('[data-slot="command-list"]');

    expect(screen.getByLabelText("Filter quick actions")).toBeTruthy();
    expect(popoverContent?.getAttribute("class")).toContain("w-96");
    expect(commandList?.getAttribute("class")).toContain("max-h-[32rem]");

    unmount();
  });

  test("filters quick actions by action label instead of description text", async () => {
    const { unmount } = render(
      createElement(AgentStudioHeader, {
        repoActions: null,
        viewControls: null,
        openIn: null,
        model: {
          ...buildModel(),
          quickActions: [
            {
              kind: "session_start" as const,
              id: "quick:build_implementation_start",
              role: "build" as const,
              launchActionId: "build_implementation_start" as const,
              label: "Start Implementation",
              description: "Open the start-session flow for Builder implementation work.",
              postStartAction: "kickoff" as const,
              disabled: false,
            },
          ],
          sessionCreateOptions: [],
          primaryQuickAction: {
            kind: "session_start" as const,
            id: "quick:build_implementation_start",
            role: "build" as const,
            launchActionId: "build_implementation_start" as const,
            label: "Start Implementation",
            description: "Open the start-session flow for Builder implementation work.",
            postStartAction: "kickoff" as const,
            disabled: false,
          },
        },
      }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Open quick actions menu/i }));
    });

    await act(async () => {
      fireEvent.input(screen.getByPlaceholderText("Filter actions…"), {
        target: { value: "flow" },
      });
    });

    expect(screen.queryByRole("option", { name: /Start Implementation/i })).toBeNull();
    expect(screen.getByText("No quick actions available.")).toBeTruthy();

    unmount();
  });

  test("closes quick-actions menu when actions become unavailable", async () => {
    const { rerender } = render(
      createElement(AgentStudioHeader, {
        repoActions: null,
        viewControls: null,
        openIn: null,
        model: buildModel(),
      }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Open quick actions menu/i }));
    });
    expect(screen.getByText("Prepare Builder session")).toBeTruthy();

    await act(async () => {
      rerender(
        createElement(AgentStudioHeader, {
          repoActions: null,
          viewControls: null,
          openIn: null,
          model: {
            ...buildModel(),
            agentStudioReady: false,
          },
        }),
      );
    });

    expect(screen.queryByText("Prepare Builder session")).toBeNull();

    await act(async () => {
      rerender(
        createElement(AgentStudioHeader, {
          repoActions: null,
          viewControls: null,
          openIn: null,
          model: buildModel(),
        }),
      );
    });

    expect(screen.queryByText("Prepare Builder session")).toBeNull();
  });

  test("routes git conflict quick action through the conflict handler", async () => {
    const onQuickAction = mock(() => {});
    const onResolveGitConflictQuickAction = mock(() => {});
    render(
      createElement(AgentStudioHeader, {
        repoActions: null,
        viewControls: null,
        openIn: null,
        model: {
          ...buildModel(),
          quickActions: [
            {
              kind: "session_start" as const,
              id: "quick:build_rebase_conflict_resolution",
              role: "build" as const,
              launchActionId: "build_rebase_conflict_resolution" as const,
              surface: "git_conflict" as const,
              label: "Resolve Git Conflict",
              description: "Ask Builder to resolve the active git conflict.",
              postStartAction: "send_message" as const,
              disabled: false,
            },
          ],
          primaryQuickAction: {
            kind: "session_start" as const,
            id: "quick:build_rebase_conflict_resolution",
            role: "build" as const,
            launchActionId: "build_rebase_conflict_resolution" as const,
            surface: "git_conflict" as const,
            label: "Resolve Git Conflict",
            description: "Ask Builder to resolve the active git conflict.",
            postStartAction: "send_message" as const,
            disabled: false,
          },
          onQuickAction,
          onResolveGitConflictQuickAction,
        },
      }),
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Run quick action: Resolve Git Conflict/i }),
      );
    });

    expect(onResolveGitConflictQuickAction).toHaveBeenCalled();
    expect(onQuickAction).not.toHaveBeenCalled();
  });

  test("disables git conflict quick action when the conflict handler is missing", async () => {
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(QuickActionsMenu, {
          canOpenActionsMenu: true,
          workflowSteps: buildModel().workflowSteps,
          isOpen: true,
          onOpenChange: () => {},
          agentStudioReady: true,
          isCreatingSession: false,
          options: [
            {
              kind: "session_start" as const,
              id: "quick:build_rebase_conflict_resolution",
              role: "build" as const,
              launchActionId: "build_rebase_conflict_resolution" as const,
              surface: "git_conflict" as const,
              label: "Resolve Git Conflict",
              description: "Ask Builder to resolve the active git conflict.",
              postStartAction: "send_message" as const,
              disabled: false,
            },
          ],
          primaryAction: {
            kind: "session_start" as const,
            id: "quick:build_rebase_conflict_resolution",
            role: "build" as const,
            launchActionId: "build_rebase_conflict_resolution" as const,
            surface: "git_conflict" as const,
            label: "Resolve Git Conflict",
            description: "Ask Builder to resolve the active git conflict.",
            postStartAction: "send_message" as const,
            disabled: false,
          },
          sessionCreateOptions: [],
          onQuickAction: () => {},
          onPrepareMessageFirstSession: () => {},
          onResolveGitConflictQuickAction: null,
        }),
      ),
    );

    expect(html).toMatch(
      /<button[^>]*(aria-label="Run quick action: Resolve Git Conflict"[^>]*disabled=""|disabled=""[^>]*aria-label="Run quick action: Resolve Git Conflict")/,
    );
  });

  test("hides the task details button when no task is selected", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioHeader, {
        repoActions: null,
        viewControls: null,
        openIn: null,
        model: {
          ...buildModel(),
          taskId: null,
          onOpenTaskDetails: null,
        },
      }),
    );

    expect(html).not.toContain('aria-label="Open task details"');
    expect(html).not.toContain("Prepare new session");
  });

  test("disables controls when studio is blocked", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioHeader, {
        repoActions: null,
        viewControls: null,
        openIn: null,
        model: {
          ...buildModel(),
          agentStudioReady: false,
        },
      }),
    );

    expect(html).toMatch(
      /<button[^>]*(aria-label="Session history[^"]*"[^>]*disabled=""|disabled=""[^>]*aria-label="Session history[^"]*")/,
    );
    expect(html).toMatch(
      /<button[^>]*(aria-label="Run quick action:[^"]*"[^>]*disabled=""|disabled=""[^>]*aria-label="Run quick action:[^"]*")/,
    );
    expect(html).toMatch(
      /<button[^>]*(aria-label="Open quick actions menu"[^>]*disabled=""|disabled=""[^>]*aria-label="Open quick actions menu")/,
    );
  });

  test("disables session history trigger when selector is disabled", () => {
    const model = buildModel();
    const html = renderToStaticMarkup(
      createElement(AgentStudioHeader, {
        repoActions: null,
        viewControls: null,
        openIn: null,
        model: {
          ...model,
          sessionSelector: {
            ...model.sessionSelector,
            disabled: true,
          },
        },
      }),
    );

    expect(html).toMatch(
      /<button[^>]*(aria-label="Session history[^"]*"[^>]*disabled=""|disabled=""[^>]*aria-label="Session history[^"]*")/,
    );
  });

  test("disables quick action launch while a session is starting without showing a loader", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStudioHeader, {
        repoActions: null,
        viewControls: null,
        openIn: null,
        model: {
          ...buildModel(),
          isCreatingSession: true,
        },
      }),
    );

    expect(html).toMatch(
      /<button[^>]*(aria-label="Run quick action: Start Implementation"[^>]*disabled=""|disabled=""[^>]*aria-label="Run quick action: Start Implementation")/,
    );
    expect(html).toMatch(
      /<button[^>]*(aria-label="Open quick actions menu"[^>]*disabled=""|disabled=""[^>]*aria-label="Open quick actions menu")/,
    );
    expect(html).toContain("lucide-zap");
    expect(html).not.toContain("Prepare new session");
  });

  test("keeps unavailable workflow step clickable without existing session", () => {
    const html = renderWorkflow({
      selectedStepId: "qa",
      steps: [
        {
          role: "spec" as const,
          label: "Spec",
          icon: roleIcon(0),
          state: {
            tone: "in_progress" as const,
            availability: "available" as const,
            completion: "in_progress" as const,
            liveSession: "running" as const,
            waitingOnBackground: false,
          },
          sessionValue: "spec-session",
        },
        {
          role: "planner" as const,
          label: "Planner",
          icon: roleIcon(1),
          state: {
            tone: "blocked" as const,
            availability: "blocked" as const,
            completion: "not_started" as const,
            liveSession: "none" as const,
            waitingOnBackground: false,
          },
          sessionValue: null,
        },
      ],
    });

    expect(html).toContain('title="Blocked by workflow state"');
    expect(html).not.toContain('title="Blocked by workflow state" disabled');
  });

  test("highlights selected role with a ring without changing done status color", () => {
    const html = renderWorkflow({
      selectedStepId: "planner",
      steps: [
        {
          role: "planner" as const,
          label: "Planner",
          icon: roleIcon(1),
          state: {
            tone: "done" as const,
            availability: "available" as const,
            completion: "done" as const,
            liveSession: "idle" as const,
            waitingOnBackground: false,
          },
          sessionValue: "planner-session",
        },
      ],
    });

    expect(html).toContain("ring-2 ring-offset-2 ring-offset-card ring-success-ring");
    expect(html).toContain("border-success-border");
    expect(html).toContain("bg-success-surface");
    expect(html).toContain("text-success-muted");
  });

  for (const Rail of [WorkflowRail, WorkflowRailPreview]) {
    test(`${Rail.name} selects distinct steps by ID and keeps their order`, () => {
      const buildStep = buildModel().workflowSteps[2]!;
      const steps: WorkflowRailStep[] = [
        { ...buildStep, id: "implementation:retry", label: "Retry implementation" },
        {
          id: "human:release",
          label: "Approve release",
          icon: roleIcon(0),
          state: {
            tone: "available",
            availability: "available",
            completion: "not_started",
            liveSession: "none",
            waitingOnBackground: false,
          },
          hint: "Review the release and approve it",
          attentionVariant: "none",
        },
        { ...buildStep, id: "implementation:initial", label: "Initial implementation" },
      ];
      const onStepSelect = mock((_stepId: string) => {});
      const view = render(
        createElement(Rail, {
          steps,
          selectedStepId: "implementation:initial",
          disabled: false,
          onStepSelect,
        }),
      );
      try {
        const buttons = view.getAllByRole("button");
        expect(buttons.map((button) => button.textContent)).toEqual([
          "Retry implementation",
          "Approve release",
          "Initial implementation",
        ]);
        expect(buttons.map((button) => button.getAttribute("aria-pressed"))).toEqual([
          "false",
          "false",
          "true",
        ]);
        expect(buttons[1]!.getAttribute("title")).toBe("Review the release and approve it");
        for (const button of buttons) fireEvent.click(button);
        expect(onStepSelect.mock.calls).toEqual([
          ["implementation:retry"],
          ["human:release"],
          ["implementation:initial"],
        ]);

        view.rerender(
          createElement(Rail, {
            steps: steps.toReversed(),
            selectedStepId: "implementation:retry",
            disabled: false,
            onStepSelect,
          }),
        );
        const reordered = view.getAllByRole("button");
        for (const [index, button] of reordered.entries()) {
          expect(button).toBe(buttons[buttons.length - index - 1]!);
        }
        expect(reordered.map((button) => button.getAttribute("aria-pressed"))).toEqual([
          "false",
          "false",
          "true",
        ]);
      } finally {
        view.unmount();
      }
    });
  }

  test("renders waiting-input workflow step hint and warning styling", () => {
    const html = renderWorkflow({
      selectedStepId: "qa",
      steps: [
        {
          role: "qa" as const,
          label: "QA",
          icon: roleIcon(3),
          state: {
            tone: "waiting_input" as const,
            availability: "optional" as const,
            completion: "in_progress" as const,
            liveSession: "waiting_input" as const,
            waitingOnBackground: false,
          },
          sessionValue: "qa-session",
        },
      ],
    });

    expect(html).toContain('title="Session is waiting for input"');
    expect(html).toContain("border-warning-border");
    expect(html).toContain("lucide-circle-dashed");
  });

  test("renders blocked builder warning with alert icon and blocked-task copy", () => {
    const html = renderWorkflow({
      selectedStepId: "build",
      steps: [
        {
          role: "build" as const,
          label: "Builder",
          icon: roleIcon(2),
          state: {
            tone: "waiting_input" as const,
            availability: "available" as const,
            completion: "in_progress" as const,
            liveSession: "stopped" as const,
            waitingOnBackground: false,
          },
          sessionValue: "build-session",
        },
      ],
    });

    expect(html).toContain('title="Task is blocked and waiting for user action"');
    expect(html).toContain("border-warning-border");
    expect(html).toContain("lucide-triangle-alert");
    expect(html).not.toContain("lucide-circle-dashed size-3.5");
  });

  test("renders optional workflow step as neutral dashed styling", () => {
    const html = renderWorkflow({
      selectedStepId: "qa",
      steps: [
        {
          role: "qa" as const,
          label: "QA",
          icon: roleIcon(3),
          state: {
            tone: "optional" as const,
            availability: "optional" as const,
            completion: "not_started" as const,
            liveSession: "none" as const,
            waitingOnBackground: false,
          },
          sessionValue: null,
        },
      ],
    });

    expect(html).toContain("border-dashed");
    expect(html).toContain("border-input");
    expect(html).toContain("text-foreground");
    expect(html).not.toContain("border-warning-border");
    expect(html).not.toContain("text-warning-muted");
  });

  test("does not keep the dashed border once an optional step becomes active", () => {
    const html = renderWorkflow({
      steps: [
        {
          role: "qa" as const,
          label: "QA",
          icon: roleIcon(3),
          state: {
            tone: "in_progress" as const,
            availability: "optional" as const,
            completion: "in_progress" as const,
            liveSession: "running" as const,
            waitingOnBackground: false,
          },
          sessionValue: "qa-session",
        },
      ],
    });

    expect(html).not.toContain("border-dashed");
  });

  test("renders failed workflow step hint and destructive styling", () => {
    const html = renderWorkflow({
      steps: [
        {
          role: "planner" as const,
          label: "Planner",
          icon: roleIcon(1),
          state: {
            tone: "failed" as const,
            availability: "available" as const,
            completion: "in_progress" as const,
            liveSession: "error" as const,
            waitingOnBackground: false,
          },
          sessionValue: "planner-session",
        },
      ],
    });

    expect(html).toContain('title="Latest session failed"');
    expect(html).toContain("border-destructive-border");
  });

  test("renders failed workflow step without session as actionable startup failure", () => {
    const html = renderWorkflow({
      steps: [
        {
          role: "planner" as const,
          label: "Planner",
          icon: roleIcon(1),
          state: {
            tone: "failed" as const,
            availability: "blocked" as const,
            completion: "not_started" as const,
            liveSession: "none" as const,
            waitingOnBackground: false,
          },
          sessionValue: null,
        },
      ],
    });

    expect(html).toContain('title="Step failed before a session could start"');
    expect(html).not.toContain('title="Blocked by workflow state"');
  });

  test("uses neutral rejection copy for rejected review steps", () => {
    const html = renderWorkflow({
      steps: [
        {
          role: "qa" as const,
          label: "QA",
          icon: roleIcon(3),
          state: {
            tone: "rejected" as const,
            availability: "available" as const,
            completion: "rejected" as const,
            liveSession: "idle" as const,
            waitingOnBackground: false,
          },
          sessionValue: "qa-session",
        },
      ],
    });

    expect(html).toContain('title="Latest review rejected this task"');
    expect(html).not.toContain("Latest QA review rejected this task");
    expect(html).toContain("border-rejected-border");
    expect(html).toContain("bg-rejected-surface");
    expect(html).toContain("text-rejected-muted");
  });

  test("throws for invalid workflow tones instead of masking them as blocked", () => {
    expect(() =>
      renderWorkflow({
        steps: [
          {
            role: "qa" as const,
            label: "QA",
            icon: roleIcon(3),
            state: {
              // @ts-expect-error This negative test verifies fail-fast handling of an unknown tone.
              tone: "broken",
              availability: "available" as const,
              completion: "not_started" as const,
              liveSession: "none" as const,
              waitingOnBackground: false,
            },
            sessionValue: null,
          },
        ],
      }),
    ).toThrow("Unknown workflow tone");
  });
});
