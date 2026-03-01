import { describe, expect, test } from "bun:test";
import type { KanbanColumn as KanbanColumnData } from "@openducktor/core";
import { createElement, type ReactElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { useKanbanVirtualization } from "./use-kanban-virtualization";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

type HookArgs = Parameters<typeof useKanbanVirtualization>[0];
type HookState = ReturnType<typeof useKanbanVirtualization>;

const createTasks = (count: number): KanbanColumnData["tasks"] =>
  Array.from({ length: count }, (_unused, index) => ({
    id: `task-${index}`,
  })) as KanbanColumnData["tasks"];

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const createHarness = (initialProps: HookArgs) => {
  let latest: HookState | null = null;

  const Harness = (props: HookArgs): ReactElement | null => {
    latest = useKanbanVirtualization(props);
    return null;
  };

  let renderer: TestRenderer.ReactTestRenderer | null = null;

  const mount = async (): Promise<void> => {
    await act(async () => {
      renderer = TestRenderer.create(createElement(Harness, initialProps));
      await flush();
    });
  };

  const run = async (fn: () => void): Promise<void> => {
    await act(async () => {
      fn();
      await flush();
    });
  };

  const getLatest = (): HookState => {
    if (!latest) {
      throw new Error("Hook state unavailable");
    }

    return latest;
  };

  const unmount = async (): Promise<void> => {
    if (!renderer) {
      return;
    }

    await act(async () => {
      renderer?.unmount();
      await flush();
    });
  };

  return { mount, run, getLatest, unmount };
};

describe("useKanbanVirtualization", () => {
  test("returns all tasks when virtualization threshold is not met", async () => {
    const harness = createHarness({ tasks: createTasks(5) });
    await harness.mount();

    const state = harness.getLatest();
    expect(state.shouldVirtualize).toBe(false);
    expect(state.visibleTasks).toHaveLength(5);
    expect(state.totalHeight).toBe(0);

    await harness.unmount();
  });

  test("computes virtualized totals and visible task window for large columns", async () => {
    const harness = createHarness({ tasks: createTasks(30) });
    await harness.mount();

    const state = harness.getLatest();
    expect(state.shouldVirtualize).toBe(true);
    expect(state.totalHeight).toBe(5748);
    expect(state.visibleTasks.length).toBeGreaterThan(0);
    expect(state.visibleTasks[0]?.id).toBe("task-0");

    await harness.unmount();
  });

  test("updates total height only when a measured height changes", async () => {
    const harness = createHarness({ tasks: createTasks(30) });
    await harness.mount();

    const initialTotalHeight = harness.getLatest().totalHeight;

    await harness.run(() => {
      harness.getLatest().onMeasuredHeight("task-0", 300);
    });

    const resizedTotalHeight = harness.getLatest().totalHeight;
    expect(resizedTotalHeight - initialTotalHeight).toBe(120);

    await harness.run(() => {
      harness.getLatest().onMeasuredHeight("task-0", 300);
    });

    expect(harness.getLatest().totalHeight).toBe(resizedTotalHeight);
    await harness.unmount();
  });
});
