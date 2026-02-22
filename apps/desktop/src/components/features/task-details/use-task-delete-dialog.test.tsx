import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import type { ReactElement } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { useTaskDeleteDialog } from "./use-task-delete-dialog";

type HarnessProps = {
  sheetOpen: boolean;
  task: TaskCard | null;
  hasSubtasks: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: ((taskId: string, options: { deleteSubtasks: boolean }) => Promise<void>) | undefined;
};

const reactActEnvironment = globalThis as {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const makeTask = (id: string): TaskCard => ({
  id,
  title: id,
  description: "",
  acceptanceCriteria: "",
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
    qaReport: { has: false, updatedAt: undefined },
  },
});

type HookState = ReturnType<typeof useTaskDeleteDialog>;

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("use-task-delete-dialog", () => {
  let root: ReactTestRenderer | null = null;
  let latest: HookState | null = null;

  const Harness = (props: HarnessProps): ReactElement => {
    latest = useTaskDeleteDialog({
      sheetOpen: props.sheetOpen,
      task: props.task,
      hasSubtasks: props.hasSubtasks,
      onOpenChange: props.onOpenChange,
      onDelete: props.onDelete,
    });
    return <></>;
  };

  const mount = async (props: HarnessProps): Promise<void> => {
    await act(async () => {
      root = create(<Harness {...props} />);
      await flush();
    });
  };

  const update = async (props: HarnessProps): Promise<void> => {
    await act(async () => {
      root?.update(<Harness {...props} />);
      await flush();
    });
  };

  const run = async (fn: () => void): Promise<void> => {
    await act(async () => {
      fn();
      await flush();
    });
  };

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    latest = null;
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
        await flush();
      });
    }
    root = null;
    latest = null;
  });

  test("opens dialog and confirms delete successfully", async () => {
    const onOpenChange = mock(() => {});
    const onDelete = mock(async () => {});
    const task = makeTask("ODT-1");

    await mount({ sheetOpen: true, task, hasSubtasks: true, onOpenChange, onDelete });

    await run(() => latest?.openDeleteDialog());
    expect(latest?.isDeleteDialogOpen).toBe(true);

    await run(() => latest?.confirmDelete());

    expect(onDelete).toHaveBeenCalledWith("ODT-1", { deleteSubtasks: true });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(latest?.isDeleteDialogOpen).toBe(false);
    expect(latest?.isDeletePending).toBe(false);
    expect(latest?.deleteError).toBeNull();
  });

  test("surfaces delete failure and keeps dialog open", async () => {
    const onOpenChange = mock(() => {});
    const onDelete = mock(async () => {
      throw new Error("delete failed");
    });
    const task = makeTask("ODT-2");

    await mount({ sheetOpen: true, task, hasSubtasks: false, onOpenChange, onDelete });

    await run(() => latest?.openDeleteDialog());
    await run(() => latest?.confirmDelete());

    expect(onDelete).toHaveBeenCalledWith("ODT-2", { deleteSubtasks: false });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(latest?.isDeleteDialogOpen).toBe(true);
    expect(latest?.deleteError).toBe("delete failed");
  });

  test("ignores close attempts while deletion is in flight", async () => {
    const onOpenChange = mock(() => {});
    let resolveDelete: (() => void) | null = null;
    const onDelete = mock(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        }),
    );
    const task = makeTask("ODT-3");

    await mount({ sheetOpen: true, task, hasSubtasks: true, onOpenChange, onDelete });
    await run(() => latest?.openDeleteDialog());

    await act(async () => {
      latest?.confirmDelete();
      await Promise.resolve();
    });

    expect(latest?.isDeletePending).toBe(true);
    expect(latest?.isDeleteDialogOpen).toBe(true);

    await run(() => latest?.closeDeleteDialog());
    await run(() => latest?.handleDeleteDialogOpenChange(false));
    expect(latest?.isDeleteDialogOpen).toBe(true);

    await act(async () => {
      resolveDelete?.();
      await flush();
    });

    expect(latest?.isDeletePending).toBe(false);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("resets dialog state when sheet closes", async () => {
    const onOpenChange = mock(() => {});
    const onDelete = mock(async () => {
      throw new Error("boom");
    });
    const task = makeTask("ODT-4");

    const props: HarnessProps = {
      sheetOpen: true,
      task,
      hasSubtasks: false,
      onOpenChange,
      onDelete,
    };

    await mount(props);
    await run(() => latest?.openDeleteDialog());
    await run(() => latest?.confirmDelete());

    expect(latest?.isDeleteDialogOpen).toBe(true);
    expect(latest?.deleteError).toBe("boom");

    await update({ ...props, sheetOpen: false });

    expect(latest?.isDeleteDialogOpen).toBe(false);
    expect(latest?.isDeletePending).toBe(false);
    expect(latest?.deleteError).toBeNull();
  });

  test("does nothing when delete callback is unavailable", async () => {
    const onOpenChange = mock(() => {});
    const task = makeTask("ODT-5");

    await mount({ sheetOpen: true, task, hasSubtasks: false, onOpenChange, onDelete: undefined });

    await run(() => latest?.openDeleteDialog());
    await run(() => latest?.confirmDelete());

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(latest?.isDeleteDialogOpen).toBe(true);
    expect(latest?.isDeletePending).toBe(false);
    expect(latest?.deleteError).toBeNull();
  });
});
