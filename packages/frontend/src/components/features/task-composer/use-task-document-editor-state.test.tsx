import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import {
  type TaskDocumentSection,
  useTaskDocumentEditorState,
} from "./use-task-document-editor-state";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const originalConsoleError = console.error;

type HookArgs = Parameters<typeof useTaskDocumentEditorState>[0];

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

const createDeferred = <T,>(): Deferred<T> => {
  let resolve: (value: T) => void = () => {};
  let reject: (reason?: unknown) => void = () => {};
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const createHookHarness = (initialProps: HookArgs) => {
  return createSharedHookHarness(useTaskDocumentEditorState, initialProps);
};

const createBaseProps = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  open: true,
  taskId: "task-1",
  activeSection: "spec",
  loadSpecDocument: async () => ({ markdown: "# Spec", updatedAt: "2026-02-20T10:00:00Z" }),
  loadPlanDocument: async () => ({ markdown: "## Plan", updatedAt: "2026-02-20T10:00:00Z" }),
  ...overrides,
});

describe("useTaskDocumentEditorState", () => {
  beforeEach(() => {
    console.error = (...args: unknown[]): void => {
      originalConsoleError(...args);
    };
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  test("loads first active section successfully", async () => {
    const harness = createHookHarness(createBaseProps());
    await harness.mount();
    await harness.waitFor((state) => state.documents.spec.loaded);

    const state = harness.getLatest();
    expect(state.documents.spec.loaded).toBe(true);
    expect(state.documents.spec.serverMarkdown).toBe("# Spec");
    expect(state.documents.spec.error).toBeNull();

    await harness.unmount();
  });

  test("captures loader failure and clears loading", async () => {
    const harness = createHookHarness(
      createBaseProps({
        loadSpecDocument: async () => {
          throw new Error("spec failed");
        },
      }),
    );
    await harness.mount();
    await harness.waitFor(
      (state) => !state.documents.spec.isLoading && state.documents.spec.error !== null,
    );

    const state = harness.getLatest();
    expect(state.documents.spec.loaded).toBe(false);
    expect(state.documents.spec.isLoading).toBe(false);
    expect(state.documents.spec.error).toContain("spec failed");

    await harness.unmount();
  });

  test("times out long-running loads", async () => {
    const harness = createHookHarness(
      createBaseProps({
        loadTimeoutMs: 20,
        loadSpecDocument: async () => await new Promise(() => {}),
      }),
    );

    await harness.mount();
    await harness.waitFor(
      (state) => !state.documents.spec.isLoading && state.documents.spec.error !== null,
      200,
    );

    const state = harness.getLatest();
    expect(state.documents.spec.loaded).toBe(false);
    expect(state.documents.spec.isLoading).toBe(false);
    expect(state.documents.spec.error).toContain("Timed out");

    await harness.unmount();
  });

  test("ignores stale response after task context changes", async () => {
    const first = createDeferred<{ markdown: string; updatedAt: string | null }>();
    const second = createDeferred<{ markdown: string; updatedAt: string | null }>();

    const harness = createHookHarness(
      createBaseProps({
        taskId: "task-1",
        loadSpecDocument: async (taskId: string) => {
          if (taskId === "task-1") {
            return first.promise;
          }
          if (taskId === "task-2") {
            return second.promise;
          }
          throw new Error(`Unexpected taskId ${taskId}`);
        },
      }),
    );

    await harness.mount();
    await harness.update(
      createBaseProps({
        taskId: "task-2",
        loadSpecDocument: async (taskId: string) => {
          if (taskId === "task-1") {
            return first.promise;
          }
          if (taskId === "task-2") {
            return second.promise;
          }
          throw new Error(`Unexpected taskId ${taskId}`);
        },
      }),
    );

    await harness.run(async () => {
      second.resolve({ markdown: "# Task 2", updatedAt: "2026-02-20T11:00:00Z" });
    });
    await harness.waitFor((state) => state.documents.spec.serverMarkdown === "# Task 2");

    expect(harness.getLatest().documents.spec.serverMarkdown).toBe("# Task 2");

    await harness.run(async () => {
      first.resolve({ markdown: "# Task 1", updatedAt: "2026-02-20T10:00:00Z" });
    });

    expect(harness.getLatest().documents.spec.serverMarkdown).toBe("# Task 2");

    await harness.unmount();
  });

  test("supports explicit retry after failure", async () => {
    let attempts = 0;
    const harness = createHookHarness(
      createBaseProps({
        loadSpecDocument: async () => {
          attempts += 1;
          if (attempts === 1) {
            throw new Error("first failure");
          }
          return { markdown: "# Recovered", updatedAt: "2026-02-20T12:00:00Z" };
        },
      }),
    );
    await harness.mount();
    await harness.waitFor((state) => state.documents.spec.error !== null);

    expect(harness.getLatest().documents.spec.error).toContain("first failure");

    await harness.run(async () => {
      await harness.getLatest().loadSection("spec" as TaskDocumentSection, true);
    });
    await harness.waitFor((state) => state.documents.spec.loaded);

    const state = harness.getLatest();
    expect(attempts).toBe(2);
    expect(state.documents.spec.loaded).toBe(true);
    expect(state.documents.spec.serverMarkdown).toBe("# Recovered");
    expect(state.documents.spec.error).toBeNull();

    await harness.unmount();
  });

  test("keeps document-level payload errors without treating the load as failed", async () => {
    const harness = createHookHarness(
      createBaseProps({
        loadSpecDocument: async () => ({
          markdown: "",
          updatedAt: "2026-02-20T12:00:00Z",
          error: "Failed to decode openducktor.documents.spec[0]: invalid gzip payload",
        }),
      }),
    );

    await harness.mount();
    await harness.waitFor((state) => state.documents.spec.loaded);

    const state = harness.getLatest();
    expect(state.documents.spec.loaded).toBe(true);
    expect(state.documents.spec.isLoading).toBe(false);
    expect(state.documents.spec.error).toBe(
      "Failed to decode openducktor.documents.spec[0]: invalid gzip payload",
    );

    await harness.unmount();
  });

  test("persists editor view per section and resets on task change", async () => {
    const harness = createHookHarness(createBaseProps({ activeSection: null }));
    await harness.mount();

    await harness.run(() => {
      harness.getLatest().setView("spec", "preview");
      harness.getLatest().setView("plan", "write");
    });

    expect(harness.getLatest().views.spec).toBe("preview");
    expect(harness.getLatest().views.plan).toBe("write");

    await harness.update(createBaseProps({ activeSection: null, taskId: "task-2" }));

    expect(harness.getLatest().views.spec).toBe("split");
    expect(harness.getLatest().views.plan).toBe("split");

    await harness.unmount();
  });
});
