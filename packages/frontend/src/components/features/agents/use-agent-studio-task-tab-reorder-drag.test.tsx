import { describe, expect, mock, test } from "bun:test";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { act, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { useAgentStudioTaskTabReorderDrag } from "./use-agent-studio-task-tab-reorder-drag";

type HookValue = ReturnType<typeof useAgentStudioTaskTabReorderDrag>;

const dragStartEvent = (taskId: string): DragStartEvent =>
  ({
    active: { id: taskId },
  }) as DragStartEvent;

const dragEndEvent = (draggedTaskId: string, overTaskId: string | null): DragEndEvent =>
  ({
    active: { id: draggedTaskId },
    over: overTaskId === null ? null : { id: overTaskId },
  }) as DragEndEvent;

const createHarness = ({
  tabTaskIds,
  onReorderTab = mock(() => {}),
}: {
  tabTaskIds: string[];
  onReorderTab?: ReturnType<typeof mock>;
}) => {
  let latest: HookValue | null = null;

  function TestComponent(): ReactElement {
    latest = useAgentStudioTaskTabReorderDrag({
      tabTaskIds,
      onReorderTab,
    });

    return <div data-testid="task-tab-reorder-drag-harness" />;
  }

  const rendered = render(<TestComponent />);

  return {
    onReorderTab,
    getLatest(): HookValue {
      if (!latest) {
        throw new Error("Hook value unavailable");
      }

      return latest;
    },
    unmount(): void {
      rendered.unmount();
    },
  };
};

describe("useAgentStudioTaskTabReorderDrag", () => {
  test("reorders a tab before a target when dragged left", () => {
    const harness = createHarness({
      tabTaskIds: ["task-1", "task-2"],
    });

    act(() => {
      harness.getLatest().handleDragEnd(dragEndEvent("task-2", "task-1"));
    });

    expect(harness.onReorderTab).toHaveBeenCalledWith("task-2", "task-1", "before");
    harness.unmount();
  });

  test("reorders a tab after a target when dragged right", () => {
    const harness = createHarness({
      tabTaskIds: ["task-1", "task-2"],
    });

    act(() => {
      harness.getLatest().handleDragEnd(dragEndEvent("task-1", "task-2"));
    });

    expect(harness.onReorderTab).toHaveBeenCalledWith("task-1", "task-2", "after");
    harness.unmount();
  });

  test("does not reorder when dropping on the same tab or no target", () => {
    const harness = createHarness({
      tabTaskIds: ["task-1", "task-2"],
    });

    act(() => {
      harness.getLatest().handleDragEnd(dragEndEvent("task-1", "task-1"));
      harness.getLatest().handleDragEnd(dragEndEvent("task-1", null));
    });

    expect(harness.onReorderTab).toHaveBeenCalledTimes(0);
    harness.unmount();
  });

  test("tracks and clears active drag state", () => {
    const harness = createHarness({
      tabTaskIds: ["task-1", "task-2"],
    });

    act(() => {
      harness.getLatest().handleDragStart(dragStartEvent("task-2"));
    });

    expect(harness.getLatest().activeTaskId).toBe("task-2");

    act(() => {
      harness.getLatest().handleDragCancel();
    });

    expect(harness.getLatest().activeTaskId).toBeNull();

    act(() => {
      harness.getLatest().handleDragStart(dragStartEvent("task-2"));
    });

    expect(harness.getLatest().activeTaskId).toBe("task-2");

    act(() => {
      harness.getLatest().handleDragEnd(dragEndEvent("task-2", null));
    });

    expect(harness.getLatest().activeTaskId).toBeNull();
    harness.unmount();
  });
});
