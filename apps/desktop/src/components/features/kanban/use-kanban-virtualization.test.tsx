import { describe, expect, mock, test } from "bun:test";
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

const getVirtualizedRenderModel = (
  state: HookState,
): Extract<HookState["renderModel"], { kind: "virtualized" }> => {
  if (state.renderModel.kind !== "virtualized") {
    throw new Error("Expected virtualized render model");
  }

  return state.renderModel;
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

  const update = async (nextProps: HookArgs): Promise<void> => {
    if (!renderer) {
      throw new Error("Renderer not mounted");
    }

    await act(async () => {
      renderer?.update(createElement(Harness, nextProps));
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

  return { mount, update, run, getLatest, unmount };
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

const createMultiHarness = (initialPropsList: HookArgs[]) => {
  let latestStates: HookState[] = [];

  const HarnessGroup = ({ hooks }: { hooks: HookArgs[] }): ReactElement | null => {
    latestStates = hooks.map((hookProps) => useKanbanVirtualization(hookProps));
    return null;
  };

  let renderer: TestRenderer.ReactTestRenderer | null = null;

  const mount = async (): Promise<void> => {
    await act(async () => {
      renderer = TestRenderer.create(createElement(HarnessGroup, { hooks: initialPropsList }));
      await flush();
    });
  };

  const getLatestStates = (): HookState[] => latestStates;

  const run = async (fn: () => void): Promise<void> => {
    await act(async () => {
      fn();
      await flush();
    });
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

  return { mount, getLatestStates, run, unmount };
};

const installMockWindow = () => {
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
  const requestAnimationFrame = mock((_callback: FrameRequestCallback): number => 1);
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
  const callbacks: ResizeObserverCallback[] = [];

  class MockResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      callbacks.push(callback);
    }

    observe(_target: Element): void {}

    unobserve(_target: Element): void {}

    disconnect(): void {}
  }

  globalWithResizeObserver.ResizeObserver =
    MockResizeObserver as unknown as typeof ResizeObserver;

  const trigger = (): void => {
    for (const callback of callbacks) {
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
    const harness = createMultiHarness([{ tasks: createTasks(30) }, { tasks: createTasks(30) }]);

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
