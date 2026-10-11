import { describe, expect, test } from "bun:test";
import {
  createTaskCardFixture,
  createWorkspaceRecordFixture,
} from "@/test-utils/shared-test-fixtures";
import { emptyQueryGroups } from "./command-palette-groups";
import type { PaletteAction, PaletteTask } from "./command-palette-types";

const workspace = createWorkspaceRecordFixture({ workspaceId: "w" });
const paletteTask = (id: string): PaletteTask => ({
  key: `task:w:${id}`,
  workspace,
  task: createTaskCardFixture({ id, title: id }),
});
const newTask: PaletteAction = {
  key: "action:new-task",
  label: "New task",
  workspaceName: "w",
  icon: null,
  keywords: [],
  suggested: true,
  disabledReason: null,
  checked: false,
  run: () => {},
};

describe("emptyQueryGroups", () => {
  test("lists the rows that need you first and keeps them out of Recent", () => {
    const waiting = paletteTask("waiting");
    const done = paletteTask("done");

    const groups = emptyQueryGroups({
      actions: [newTask],
      needsYouKeys: [waiting.key, "task:w:gone"],
      recentItems: [
        { kind: "task", workspaceId: "w", taskId: "waiting", openedAt: 2 },
        { kind: "task", workspaceId: "w", taskId: "done", openedAt: 1 },
      ],
      taskByKey: new Map([
        [waiting.key, waiting],
        [done.key, done],
      ]),
      chatByKey: new Map(),
      loadedWorkspaceIds: new Set(["w"]),
    });

    expect(
      groups.map((group) => [group.heading, group.entries.map((entry) => entry.item.key)]),
    ).toEqual([
      ["Needs you", [waiting.key]],
      ["Actions", [newTask.key]],
      ["Recent", [done.key]],
    ]);
  });
});
