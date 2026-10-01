import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import type { AgentSessionRecord } from "@openducktor/contracts";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  createTaskCardFixture,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import { KanbanTaskCard } from "./kanban-task-card";

enableReactActEnvironment();

const noop = (): void => {};
const session = (role: AgentSessionRecord["role"]): AgentSessionRecord => ({
  externalSessionId: `${role}-session`,
  runtimeKind: "codex",
  workingDirectory: `/repo/${role}`,
  role,
  startedAt: "2026-10-01T10:00:00Z",
  selectedModel: null,
});
const cardProps = (): ComponentProps<typeof KanbanTaskCard> => ({
  task: createTaskCardFixture({
    status: "ready_for_dev",
    availableActions: ["build_start", "reset_implementation"],
  }),
  historicalSessions: [session("qa"), session("planner"), session("build"), session("spec")],
  taskActivityState: "idle",
  onOpenDetails: mock(noop),
  onDelegate: mock(noop),
  onOpenSession: mock(noop),
  onPlan: mock(noop),
  onResetImplementation: mock(noop),
});

function Card(props: ComponentProps<typeof KanbanTaskCard>) {
  return (
    <MemoryRouter>
      <TooltipProvider>
        <KanbanTaskCard {...props} />
      </TooltipProvider>
    </MemoryRouter>
  );
}

describe("Kanban card session shortcuts", () => {
  for (const taskCardView of ["normal", "compact"] as const) {
    test(`shows each role and opens Planner above Start Builder in ${taskCardView} mode`, () => {
      const props = { ...cardProps(), taskCardView };
      const view = render(<Card {...props} />);
      try {
        const controls = view
          .getAllByRole("button")
          .filter((button) => button.getAttribute("aria-label")?.endsWith(" session"));
        expect(controls.map((button) => button.textContent)).toEqual([
          "Spec",
          "Planner",
          "Builder",
          "QA",
        ]);
        const planner = view.getByRole("button", { name: "Open Planner session" });
        fireEvent.click(planner);
        expect(props.onOpenSession).toHaveBeenCalledWith(props.task.id, "planner", {
          session: session("planner"),
        });
        expect(props.onDelegate).not.toHaveBeenCalled();
        expect(props.onPlan).not.toHaveBeenCalled();
        expect(props.onOpenDetails).not.toHaveBeenCalled();
        fireEvent.click(view.getByRole("button", { name: "Start Builder" }));
        expect(props.onDelegate).toHaveBeenCalledTimes(1);
        fireEvent.click(view.getByRole("button", { name: "Open workflow actions menu" }));
        expect(view.getByRole("button", { name: "Reset Implementation" })).toBeDefined();
        expect(view.queryByRole("button", { name: "Open Planner" })).toBeNull();
        expect(view.queryByRole("button", { name: "Open Builder" })).toBeNull();
      } finally {
        view.unmount();
      }
    });
  }

  test("keeps an unresolved existing-session main action disabled", () => {
    const props = cardProps();
    props.task = createTaskCardFixture({
      status: "in_progress",
      availableActions: ["open_builder"],
    });
    props.historicalSessions = [];
    const view = render(<Card {...props} />);
    try {
      const builder = view.getByRole("button", { name: "Open Builder" });
      expect(builder.hasAttribute("disabled")).toBe(true);
      fireEvent.click(builder);
      expect(props.onOpenSession).not.toHaveBeenCalled();
      expect(props.onDelegate).not.toHaveBeenCalled();
      expect(view.queryByRole("button", { name: "Open Builder session" })).toBeNull();
      expect(view.queryByRole("button", { name: "Open workflow actions menu" })).toBeNull();
    } finally {
      view.unmount();
    }
  });

  test("omits only the exact main session and updates selection when live start times change", () => {
    const props = cardProps();
    props.hasActiveSession = true;
    props.activeSessionRole = "build";
    props.taskActivityState = "active";
    const older = {
      ...session("build"),
      externalSessionId: "shared-id",
      runtimeKind: "opencode" as const,
      activityState: "running" as const,
    };
    const newer = {
      ...older,
      runtimeKind: "codex" as const,
      workingDirectory: "/repo/new-build",
      startedAt: "2026-10-01T11:00:00Z",
    };
    props.historicalSessions = [{ ...session("planner"), externalSessionId: "shared-id" }];
    props.taskSessions = [older, newer];
    const view = render(<Card {...props} />);
    try {
      expect(view.queryByRole("button", { name: "Open Builder session" })).toBeNull();
      expect(view.queryByRole("button", { name: "Start Builder" })).toBeNull();
      fireEvent.click(view.getByRole("button", { name: "Open Planner session" }));
      expect(props.onOpenSession).toHaveBeenLastCalledWith(props.task.id, "planner", {
        session: props.historicalSessions[0],
      });
      fireEvent.click(view.getByRole("button", { name: "Builder Running" }));
      expect(props.onOpenSession).toHaveBeenLastCalledWith(props.task.id, "build", {
        session: newer,
      });
      const updatedOlder = { ...older, startedAt: "2026-10-01T12:00:00Z" };
      view.rerender(<Card {...props} taskSessions={[updatedOlder, newer]} />);
      fireEvent.click(view.getByRole("button", { name: "Builder Running" }));
      expect(props.onOpenSession).toHaveBeenLastCalledWith(props.task.id, "build", {
        session: updatedOlder,
      });
      view.rerender(
        <Card
          {...props}
          historicalSessions={[{ ...updatedOlder, role: "planner" }]}
          taskSessions={[updatedOlder, newer]}
        />,
      );
      expect(view.queryByRole("button", { name: "Open Planner session" })).toBeNull();
      fireEvent.click(view.getByRole("button", { name: "Open workflow actions menu" }));
      expect(view.queryByRole("button", { name: "Open Planner" })).toBeNull();
    } finally {
      view.unmount();
    }
  });

  test("keeps focus on retained controls and repairs it when a shortcut becomes the main session", () => {
    const props = cardProps();
    const view = render(<Card {...props} />);
    try {
      const planner = view.getByRole("button", { name: "Open Planner session" });
      planner.focus();
      view.rerender(<Card {...props} taskCardView="compact" />);
      expect(document.activeElement).toBe(planner);
      view.getByRole("button", { name: "Open Builder session" }).focus();
      view.rerender(
        <Card
          {...props}
          taskCardView="compact"
          hasActiveSession
          activeSessionRole="build"
          taskActivityState="active"
          taskSessions={[{ ...session("build"), activityState: "starting" }]}
        />,
      );
      expect(view.queryByRole("button", { name: "Open Builder session" })).toBeNull();
      expect(document.activeElement).toBe(view.getByRole("button", { name: "Builder Starting" }));
      view.rerender(<Card {...props} task={{ ...props.task, status: "closed" }} />);
      expect(document.activeElement).toBe(
        view.getByRole("button", { name: `Open details for ${props.task.title}` }),
      );
      expect(view.container.querySelector("[data-kanban-session-shortcuts]")).toBeNull();
    } finally {
      view.unmount();
    }
  });

  test("keeps the copy control focused when card density changes", () => {
    const props = cardProps();
    const view = render(<Card {...props} />);
    try {
      view.getByRole("button", { name: "Copy task ID" }).focus();
      view.rerender(<Card {...props} taskCardView="compact" />);
      expect(document.activeElement).toBe(view.getByRole("button", { name: "Copy task ID" }));
      view.rerender(<Card {...props} taskCardView="normal" />);
      expect(document.activeElement).toBe(view.getByRole("button", { name: "Copy task ID" }));
    } finally {
      view.unmount();
    }
  });

  test("disables pending workflow controls without disabling session navigation", () => {
    const props = cardProps();
    props.task = {
      ...props.task,
      availableActions: ["build_start", "set_plan", "qa_start", "reset_implementation"],
    };
    props.pendingState = {
      isSessionStarting: true,
      approvingTaskId: null,
      requestingChangesTaskId: null,
      resettingImplementationTaskId: props.task.id,
    };
    const view = render(<Card {...props} />);
    try {
      const startBuilder = view.getByRole("button", { name: "Start Builder" });
      expect(startBuilder.hasAttribute("disabled")).toBe(true);
      fireEvent.click(startBuilder);
      expect(props.onDelegate).not.toHaveBeenCalled();
      expect(
        view.getByRole("button", { name: "Open Planner session" }).hasAttribute("disabled"),
      ).toBe(false);
      fireEvent.click(view.getByRole("button", { name: "Open workflow actions menu" }));
      for (const name of ["Start Planner", "Request QA Review", "Reset Implementation"])
        expect(view.getByRole("button", { name }).hasAttribute("disabled")).toBe(true);
      fireEvent.click(view.getByRole("button", { name: "Reset Implementation" }));
      expect(props.onResetImplementation).not.toHaveBeenCalled();
      view.rerender(
        <Card
          {...props}
          pendingState={{
            ...props.pendingState,
            isSessionStarting: false,
            resettingImplementationTaskId: null,
          }}
        />,
      );
      fireEvent.click(view.getByRole("button", { name: "Start Builder" }));
      expect(props.onDelegate).toHaveBeenCalledTimes(1);
    } finally {
      view.unmount();
    }
  });

  test("preserves approval, QA feedback, and compact status badges", () => {
    const props = cardProps();
    props.task = createTaskCardFixture({
      status: "human_review",
      availableActions: ["human_approve", "human_request_changes"],
    });
    const view = render(<Card {...props} taskCardView="compact" />);
    try {
      expect(view.getByRole("button", { name: "Approve Task" })).toBeDefined();
      const rejectedTask = {
        ...props.task,
        status: "in_progress" as const,
        labels: ["hidden-label"],
        availableActions: ["build_start" as const],
        documentSummary: {
          ...props.task.documentSummary,
          qaReport: { has: true, updatedAt: undefined, verdict: "rejected" as const },
        },
      };
      view.rerender(<Card {...props} task={rejectedTask} taskCardView="compact" />);
      expect(view.getByText("QA Rejected")).toBeDefined();
      expect(view.getByRole("button", { name: "Address QA Feedbacks" })).toBeDefined();
      expect(view.queryByText("hidden-label")).toBeNull();
      expect(view.getByRole("button", { name: "Open QA session" })).toBeDefined();
    } finally {
      view.unmount();
    }
  });

  test("repairs focus when the workflow chevron disappears and keeps a returning menu closed", () => {
    const props = cardProps();
    const view = render(<Card {...props} />);
    try {
      const trigger = view.getByRole("button", { name: "Open workflow actions menu" });
      trigger.focus();
      fireEvent.click(trigger);
      view.getByRole("button", { name: "Reset Implementation" }).focus();
      view.rerender(
        <Card {...props} task={{ ...props.task, availableActions: ["build_start"] }} />,
      );
      expect(view.queryByRole("button", { name: "Open workflow actions menu" })).toBeNull();
      expect(document.activeElement).toBe(view.getByRole("button", { name: "Start Builder" }));
      view.rerender(<Card {...props} />);
      expect(view.queryByRole("button", { name: "Reset Implementation" })).toBeNull();
    } finally {
      view.unmount();
    }
  });
});
