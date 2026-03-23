import { describe, expect, mock, test } from "bun:test";
import type { KanbanColumn as KanbanColumnData } from "@openducktor/core";
import type { RenderResult } from "@testing-library/react";
import { render } from "@testing-library/react";
import { act, createElement, type ReactElement } from "react";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
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

const getVirtualizedRenderModel = (
  state: HookState,
): Extract<HookState["renderModel"], { kind: "virtualized" }> => {
  if (state.renderModel.kind !== "virtualized") {
    throw new Error("Expected virtualized render model");
  }

  return state.renderModel;
};

const createHarness = (initialProps: HookArgs) => {
  return createSharedHookHarness(useKanbanVirtualization, initialProps);
};

const attachContainer = async (
  harness: Pick<ReturnType<typeof createHarness>, "getLatest" | "run">,
  container?: Partial<HTMLDivElement>,
): Promise<void> => {
  await harness.run(() => {
    harness.getLatest().containerRef({
      getBoundingClientRect: () => ({ top: 0 }),
      closest: () => null,
      ...container,
    } as HTMLDivElement);
  });
};

const createPairHarness = (initialPropsList: [HookArgs, HookArgs]) => {
  let latestStates: HookState[] = [];

  const HarnessGroup = ({
    firstHook,
    secondHook,
  }: {
    firstHook: HookArgs;
    secondHook: HookArgs;
  }): ReactElement | null => {
    const firstState = useKanbanVirtualization(firstHook);
    const secondState = useKanbanVirtualization(secondHook);
    latestStates = [firstState, secondState];
    return null;
  };

  let rendered: RenderResult | null = null;

  const mount = async (): Promise<void> => {
    await act(async () => {
      rendered = render(
        createElement(HarnessGroup, {
          firstHook: initialPropsList[0],
          secondHook: initialPropsList[1],
        }),
      );
    });
  };

  const getLatestStates = (): HookState[] => latestStates;

  const run = async (fn: () => void): Promise<void> => {
    await act(async () => {
      fn();
    });
  };

  const unmount = async (): Promise<void> => {
    if (!rendered) {
      return;
    }

    await act(async () => {
      rendered?.unmount();
    });
  };

  return { mount, getLatestStates, run, unmount };
};

const installMockWindow = ({
  runAnimationFrameCallbacks = false,
}: {
  runAnimationFrameCallbacks?: boolean;
} = {}) => {
  const globalWithWindow = globalThis as typeof globalThis & {
    window?: Window & typeof globalThis;
  };
  const previousWindow = globalWithWindow.window;

  const addEventListener = mock(
    (_type: string, _listener: EventListenerOrEventListenerObject, _options?: unknown) => {},
  );
  const removeEventListener = mock(
    (_type: string, _listener: EventListenerOrEventListenerObject, _options?: unknown) => {},
  );
  const requestAnimationFrame = mock((callback: FrameRequestCallback): number => {
    if (runAnimationFrameCallbacks) {
      callback(0);
    }
    return 1;
  });
  const cancelAnimationFrame = mock((_handle: number) => {});

  globalWithWindow.window = {
    innerHeight: 900,
    addEventListener: addEventListener as unknown as Window["addEventListener"],
    removeEventListener: removeEventListener as unknown as Window["removeEventListener"],
    requestAnimationFrame: requestAnimationFrame as unknown as Window["requestAnimationFrame"],
    cancelAnimationFrame: cancelAnimationFrame as unknown as Window["cancelAnimationFrame"],
  } as Window & typeof globalThis;

  const restore = (): void => {
    if (typeof previousWindow === "undefined") {
      delete globalWithWindow.window;
      return;
    }

    globalWithWindow.window = previousWindow;
  };

  return {
    addEventListener,
    removeEventListener,
    requestAnimationFrame,
    cancelAnimationFrame,
    restore,
  };
};

const installMockResizeObserver = () => {
  const globalWithResizeObserver = globalThis as typeof globalThis & {
    ResizeObserver?: typeof ResizeObserver;
  };
  const previousResizeObserver = globalWithResizeObserver.ResizeObserver;
  const activeCallbacks = new Set<ResizeObserverCallback>();

  class MockResizeObserver {
    private callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }

    observe(_target: Element): void {
      activeCallbacks.add(this.callback);
    }

    unobserve(_target: Element): void {}

    disconnect(): void {
      activeCallbacks.delete(this.callback);
    }
  }

  globalWithResizeObserver.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

  const trigger = (): void => {
    for (const callback of [...activeCallbacks]) {
      callback([], {} as ResizeObserver);
    }
  };

  const restore = (): void => {
    if (typeof previousResizeObserver === "undefined") {
      delete globalWithResizeObserver.ResizeObserver;
      return;
    }

    globalWithResizeObserver.ResizeObserver = previousResizeObserver;
  };

  return { trigger, restore };
};

describe("useKanbanVirtualization", () => {
  test("returns a simple render model when virtualization threshold is not met", async () => {
    const harness = createHarness({ tasks: createTasks(5) });
    await harness.mount();

    const state = harness.getLatest();
    expect(state.renderModel.kind).toBe("simple");
    expect(state.renderModel.visibleTasks).toHaveLength(5);

    await harness.unmount();
  });

  test("computes virtualized totals and visible task window for large columns", async () => {
    const harness = createHarness({ tasks: createTasks(30) });
    await harness.mount();

    const state = harness.getLatest();
    const renderModel = getVirtualizedRenderModel(state);
    expect(renderModel.totalHeight).toBe(5748);
    expect(renderModel.visibleTasks.length).toBeGreaterThan(0);
    expect(renderModel.visibleTasks[0]?.id).toBe("task-0");

    await harness.unmount();
  });

  test("updates total height only when a measured height changes", async () => {
    const harness = createHarness({ tasks: createTasks(30) });
    await harness.mount();

    const initialTotalHeight = getVirtualizedRenderModel(harness.getLatest()).totalHeight;

    await harness.run(() => {
      harness.getLatest().onMeasuredHeight("task-0", 300);
    });

    const resizedTotalHeight = getVirtualizedRenderModel(harness.getLatest()).totalHeight;
    expect(resizedTotalHeight - initialTotalHeight).toBe(120);

    await harness.run(() => {
      harness.getLatest().onMeasuredHeight("task-0", 300);
    });

    expect(getVirtualizedRenderModel(harness.getLatest()).totalHeight).toBe(resizedTotalHeight);
    await harness.unmount();
  });

  test("switches render mode when task count crosses virtualization threshold", async () => {
    const harness = createHarness({ tasks: createTasks(29) });
    await harness.mount();

    expect(harness.getLatest().renderModel.kind).toBe("simple");

    await harness.update({ tasks: createTasks(30) });
    expect(harness.getLatest().renderModel.kind).toBe("virtualized");

    await harness.update({ tasks: createTasks(29) });
    const latest = harness.getLatest();
    expect(latest.renderModel.kind).toBe("simple");
    expect(latest.renderModel.visibleTasks).toHaveLength(29);

    await harness.unmount();
  });

  test("prunes removed task measurements before re-entering virtualization", async () => {
    const harness = createHarness({ tasks: createTasks(30) });
    await harness.mount();

    const initialTotalHeight = getVirtualizedRenderModel(harness.getLatest()).totalHeight;

    await harness.run(() => {
      harness.getLatest().onMeasuredHeight("task-29", 300);
    });
    expect(getVirtualizedRenderModel(harness.getLatest()).totalHeight - initialTotalHeight).toBe(
      120,
    );

    await harness.update({ tasks: createTasks(29) });
    expect(harness.getLatest().renderModel.kind).toBe("simple");

    await harness.update({ tasks: createTasks(30) });
    expect(getVirtualizedRenderModel(harness.getLatest()).totalHeight).toBe(initialTotalHeight);

    await harness.unmount();
  });

  test("keeps global listeners stable while measured heights change", async () => {
    const mockWindow = installMockWindow();
    const harness = createHarness({ tasks: createTasks(30) });

    try {
      await harness.mount();
      await attachContainer(harness);
      expect(mockWindow.addEventListener).toHaveBeenCalledTimes(2);
      expect(mockWindow.requestAnimationFrame).toHaveBeenCalledTimes(1);

      await harness.run(() => {
        harness.getLatest().onMeasuredHeight("task-0", 320);
      });
      expect(mockWindow.addEventListener).toHaveBeenCalledTimes(2);

      await harness.unmount();
      expect(mockWindow.removeEventListener).toHaveBeenCalledTimes(2);
    } finally {
      await harness.unmount();
      mockWindow.restore();
    }
  });

  test("recomputes viewport when measured heights change without scroll events", async () => {
    const mockWindow = installMockWindow();
    const harness = createHarness({ tasks: createTasks(30) });
    const getBoundingClientRect = mock(() => ({ top: 120 }));

    try {
      await harness.mount();

      await harness.run(() => {
        harness.getLatest().containerRef({
          getBoundingClientRect,
          closest: () => null,
        } as unknown as HTMLDivElement);
      });

      const callsBeforeMeasure = getBoundingClientRect.mock.calls.length;

      await harness.run(() => {
        harness.getLatest().onMeasuredHeight("task-0", 320);
      });

      expect(getBoundingClientRect.mock.calls.length).toBeGreaterThan(callsBeforeMeasure);
      expect(mockWindow.addEventListener).toHaveBeenCalledTimes(2);
    } finally {
      await harness.unmount();
      mockWindow.restore();
    }
  });

  test("invalidates visible-card measurements when the lane container resizes", async () => {
    const resizeObserver = installMockResizeObserver();
    const harness = createHarness({ tasks: createTasks(30) });

    try {
      await harness.mount();
      await attachContainer(harness);

      const initialMeasurementVersion = harness.getLatest().measurementVersion;

      await harness.run(() => {
        resizeObserver.trigger();
      });

      expect(harness.getLatest().measurementVersion).toBe(initialMeasurementVersion + 1);
    } finally {
      await harness.unmount();
      resizeObserver.restore();
    }
  });

  test("recomputes the virtual window when the lane container resizes", async () => {
    const mockWindow = installMockWindow({ runAnimationFrameCallbacks: true });
    const resizeObserver = installMockResizeObserver();
    const harness = createHarness({ tasks: createTasks(30) });
    const getBoundingClientRect = mock(() => ({ top: 120 }));

    try {
      await harness.mount();
      await harness.run(() => {
        harness.getLatest().containerRef({
          getBoundingClientRect,
          closest: () => null,
        } as unknown as HTMLDivElement);
      });

      const callsBeforeResize = getBoundingClientRect.mock.calls.length;

      await harness.run(() => {
        resizeObserver.trigger();
      });

      expect(getBoundingClientRect.mock.calls.length).toBeGreaterThan(callsBeforeResize);
    } finally {
      await harness.unmount();
      resizeObserver.restore();
      mockWindow.restore();
    }
  });

  test("shares global viewport listeners across multiple virtualized lanes", async () => {
    const mockWindow = installMockWindow();
    const scrollContainerAddEventListener = mock(
      (_type: string, _listener: EventListenerOrEventListenerObject, _options?: unknown) => {},
    );
    const scrollContainerRemoveEventListener = mock(
      (_type: string, _listener: EventListenerOrEventListenerObject, _options?: unknown) => {},
    );
    const scrollContainer = {
      addEventListener: scrollContainerAddEventListener,
      removeEventListener: scrollContainerRemoveEventListener,
      getBoundingClientRect: () => ({ top: 0 }),
      clientHeight: 900,
    } as unknown as HTMLElement;
    const harness = createPairHarness([{ tasks: createTasks(30) }, { tasks: createTasks(30) }]);

    try {
      await harness.mount();
      await harness.run(() => {
        for (const state of harness.getLatestStates()) {
          state.containerRef({
            getBoundingClientRect: () => ({ top: 0 }),
            closest: () => scrollContainer,
          } as unknown as HTMLDivElement);
        }
      });

      expect(mockWindow.addEventListener).toHaveBeenCalledTimes(2);
      expect(mockWindow.requestAnimationFrame).toHaveBeenCalledTimes(1);
      expect(scrollContainerAddEventListener).toHaveBeenCalledTimes(1);
      expect(harness.getLatestStates()).toHaveLength(2);

      await harness.unmount();
      expect(mockWindow.removeEventListener).toHaveBeenCalledTimes(2);
      expect(scrollContainerRemoveEventListener).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
      mockWindow.restore();
    }
  });
});
