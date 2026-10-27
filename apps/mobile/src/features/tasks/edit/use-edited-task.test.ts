import { type BuiltinTaskCard as TaskCard } from "@openducktor/workflows";
import "@openducktor/frontend-core/test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import { createTaskCardFixture } from "@openducktor/frontend-core/test-support/shared-test-fixtures";
import { renderHook } from "@testing-library/react";
import { useEditedTask } from "./use-edited-task";

const render = (initial: TaskCard | null) =>
  renderHook(({ live }: { live: TaskCard | null }) => useEditedTask(live), {
    initialProps: { live: initial },
  });

describe("useEditedTask", () => {
  test("keeps the last version when the task leaves the task list", () => {
    const first = createTaskCardFixture({ id: "TASK-1", title: "First" });
    const updated = createTaskCardFixture({ id: "TASK-1", title: "Updated" });
    const editor = render(first);

    editor.rerender({ live: updated });
    editor.rerender({ live: null });

    expect(editor.result.current).toBe(updated);
  });

  test("finds no task when the list never had it", () => {
    const editor = render(null);

    expect(editor.result.current).toBeNull();
  });
});
