import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import { act } from "react";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import { useTaskResetDialog } from "./use-task-reset-dialog";

type HarnessProps = {
  sheetOpen: boolean;
  task: TaskCard | null;
  onOpenChange: (open: boolean) => void;
  onResetTask: ((taskId: string) => Promise<void>) | undefined;
};

const reactActEnvironment = globalThis as {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const makeTask = (id: string): TaskCard => ({
  id,
  title: id,
  description: "",
  notes: "",
  status: "open",
  priority: 2,
  issueType: "task",
  labels: [],
  aiReviewEnabled: false,
  availableActions: [],
  parentId: undefined,
  subtaskIds: [],
  assignee: undefined,
  updatedAt: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  documentSummary: {
    spec: { has: false, updatedAt: undefined },
    plan: { has: false, updatedAt: undefined },
    qaReport: { has: false, updatedAt: undefined, verdict: "not_reviewed" },
  },
  agentWorkflows: {
    spec: { required: false, canSkip: true, available: true, completed: false },
    planner: { required: false, canSkip: true, available: true, completed: false },
    builder: { required: true, canSkip: false, available: true, completed: false },
    qa: { required: false, canSkip: true, available: false, completed: false },
  },
});

describe("use-task-reset-dialog", () => {
  let latest: ReturnType<typeof useTaskResetDialog> | null = null;
  let harness: ReturnType<typeof createSharedHookHarness<HarnessProps, null>> | null = null;

  const createHarness = (props: HarnessProps) =>
    createSharedHookHarness((currentProps: HarnessProps) => {
      latest = useTaskResetDialog(currentProps);
      return null;
    }, props);

  const mount = async (props: HarnessProps): Promise<void> => {
    harness = createHarness(props);
    await harness.mount();
  };

  const run = async (fn: () => void | Promise<void>): Promise<void> => {
    if (!harness) {
      throw new Error("Harness not mounted");
    }
    await harness.run(async () => {
      await fn();
    });
  };

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    latest = null;
    harness = null;
  });

  afterEach(async () => {
    await harness?.unmount();
    harness = null;
    latest = null;
  });

  test("closes the sheet after a successful reset", async () => {
    const onOpenChange = mock(() => {});
    const onResetTask = mock(async () => {});
    const task = makeTask("ODT-1");

    await mount({ sheetOpen: true, task, onOpenChange, onResetTask });

    await run(() => latest?.openResetDialog());
    await run(() => latest?.confirmReset());

    expect(onResetTask).toHaveBeenCalledWith("ODT-1");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(latest?.isResetDialogOpen).toBe(false);
    expect(latest?.resetError).toBeNull();
  });

  test("surfaces reset failures and keeps the dialog open", async () => {
    const onResetTask = mock(async () => {
      throw new Error("reset failed");
    });
    const task = makeTask("ODT-2");

    await mount({ sheetOpen: true, task, onOpenChange: () => {}, onResetTask });

    await run(() => latest?.openResetDialog());
    await run(() => latest?.confirmReset());

    expect(latest?.isResetDialogOpen).toBe(true);
    expect(latest?.resetError).toBe("reset failed");
  });

  test("ignores close attempts while reset is in flight", async () => {
    let resolveReset: (() => void) | null = null;
    const onResetTask = mock(
      () =>
        new Promise<void>((resolve) => {
          resolveReset = resolve;
        }),
    );

    await mount({
      sheetOpen: true,
      task: makeTask("ODT-3"),
      onOpenChange: () => {},
      onResetTask,
    });

    await run(() => latest?.openResetDialog());
    await act(async () => {
      latest?.confirmReset();
      await Promise.resolve();
    });

    await run(() => latest?.closeResetDialog());
    expect(latest?.isResetDialogOpen).toBe(true);

    await run(() => {
      resolveReset?.();
    });

    expect(latest?.isResetPending).toBe(false);
  });
});
