import { describe, expect, mock, spyOn, test } from "bun:test";
import type { RenderResult } from "@testing-library/react";
import { render } from "@testing-library/react";
import { act, createElement, type ReactElement } from "react";
import { createTaskCardFixture } from "@/test-utils/shared-test-fixtures";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import { useKanbanVirtualization } from "./use-kanban-virtualization";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
  writable: true,
});

type HookArgs = Parameters<typeof useKanbanVirtualization>[0];
type HookState = ReturnType<typeof useKanbanVirtualization>;

const createTasks = (count: number) =>
  Array.from({ length: count }, (_unused, index) => createTaskCardFixture({ id: `task-${index}` }));

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

type ContainerElementOptions = {
  getBoundingClientRect?: () => DOMRect;
  closest?: () => Element | null;
};

const createContainerElement = ({
  getBoundingClientRect = () => new DOMRect(),
  closest = () => null,
}: ContainerElementOptions = {}): HTMLDivElement => {
  const container = document.createElement("div");
  Object.defineProperties(container, {
    getBoundingClientRect: { configurable: true, value: getBoundingClientRect },
    closest: { configurable: true, value: closest },
  });
  return container;
};

const attachContainer = async (
  harness: Pick<ReturnType<typeof createHarness>, "getLatest" | "run">,
): Promise<void> => {
  await harness.run(() => {
    harness.getLatest().containerRef(createContainerElement());
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
    const mounted = rendered;
    rendered = null;

    await act(async () => {
      mounted.unmount();
    });
  };

  return { mount, getLatestStates, run, unmount };
};

const installMockWindow = ({
  runAnimationFrameCallbacks = false,
}: {
  runAnimationFrameCallbacks?: boolean;
} = {}) => {
  const previousDescriptors = {
    innerHeight: Object.getOwnPropertyDescriptor(window, "innerHeight"),
    addEventListener: Object.getOwnPropertyDescriptor(window, "addEventListener"),
    removeEventListener: Object.getOwnPropertyDescriptor(window, "removeEventListener"),
    requestAnimationFrame: Object.getOwnPropertyDescriptor(window, "requestAnimationFrame"),
    cancelAnimationFrame: Object.getOwnPropertyDescriptor(window, "cancelAnimationFrame"),
  };

  const addEventListener = mock(
    (
      _type: string,
      _listener: EventListenerOrEventListenerObject,
      _options?: boolean | AddEventListenerOptions,
    ) => {},
  );
  const removeEventListener = mock(
    (
      _type: string,
      _listener: EventListenerOrEventListenerObject,
      _options?: boolean | EventListenerOptions,
    ) => {},
  );
  const requestAnimationFrame = mock((callback: FrameRequestCallback): number => {
    if (runAnimationFrameCallbacks) {
      callback(0);
    }
    return 1;
  });
  const cancelAnimationFrame = mock((_handle: number) => {});

  Object.defineProperties(window, {
    innerHeight: { configurable: true, value: 900 },
    addEventListener: { configurable: true, value: addEventListener },
    removeEventListener: { configurable: true, value: removeEventListener },
    requestAnimationFrame: { configurable: true, value: requestAnimationFrame },
    cancelAnimationFrame: { configurable: true, value: cancelAnimationFrame },
  });

  const restore = (): void => {
    for (const [property, descriptor] of Object.entries(previousDescriptors)) {
      if (descriptor) {
        Object.defineProperty(window, property, descriptor);
      } else {
        Reflect.deleteProperty(window, property);
      }
    }
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
  const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
  const activeObservers = new Map<ResizeObserverCallback, ResizeObserver>();

  class MockResizeObserver implements ResizeObserver {
    readonly #callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
      this.#callback = callback;
    }

    observe(_target: Element): void {
      activeObservers.set(this.#callback, this);
    }

    unobserve(_target: Element): void {}

    disconnect(): void {
      activeObservers.delete(this.#callback);
    }
  }

  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: MockResizeObserver,
  });

  const trigger = (): void => {
    for (const [callback, observer] of Array.from(activeObservers)) {
      callback([], observer);
    }
  };

  const restore = (): void => {
    if (previousDescriptor) {
      Object.defineProperty(globalThis, "ResizeObserver", previousDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "ResizeObserver");
    }
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
    const getBoundingClientRect = mock(() => new DOMRect(0, 120));

    try {
      await harness.mount();

      await harness.run(() => {
        harness.getLatest().containerRef(createContainerElement({ getBoundingClientRect }));
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
    const getBoundingClientRect = mock(() => new DOMRect(0, 120));

    try {
      await harness.mount();
      await harness.run(() => {
        harness.getLatest().containerRef(createContainerElement({ getBoundingClientRect }));
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
    const scrollContainer = document.createElement("div");
    Object.defineProperties(scrollContainer, {
      getBoundingClientRect: { configurable: true, value: () => new DOMRect() },
      clientHeight: { configurable: true, value: 900 },
    });
    const scrollContainerAddEventListener = spyOn(scrollContainer, "addEventListener");
    const scrollContainerRemoveEventListener = spyOn(scrollContainer, "removeEventListener");
    const harness = createPairHarness([{ tasks: createTasks(30) }, { tasks: createTasks(30) }]);

    try {
      await harness.mount();
      await harness.run(() => {
        for (const state of harness.getLatestStates()) {
          state.containerRef(
            createContainerElement({
              closest: () => scrollContainer,
            }),
          );
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
