import { describe, expect, test } from "bun:test";
import type { TaskCard } from "./contracts";
import { TaskIndexCache } from "./task-index-cache";

const makeTask = (input: {
  id: string;
  title: string;
  status?: TaskCard["status"];
  issueType?: TaskCard["issueType"];
  aiReviewEnabled?: boolean;
}): TaskCard => {
  return {
    id: input.id,
    title: input.title,
    status: input.status ?? "open",
    issueType: input.issueType ?? "feature",
    aiReviewEnabled: input.aiReviewEnabled ?? true,
  };
};

describe("TaskIndexCache", () => {
  test("getOrBuild caches list calls until invalidated", async () => {
    const calls: TaskCard[][] = [];
    const cache = new TaskIndexCache(async () => {
      const tasks = [makeTask({ id: "task-1", title: "Task 1" })];
      calls.push(tasks);
      return tasks;
    });

    const first = await cache.getOrBuild();
    const second = await cache.getOrBuild();

    expect(first).toBe(second);
    expect(calls).toHaveLength(1);

    cache.invalidate();
    const third = await cache.getOrBuild();
    expect(third).not.toBe(first);
    expect(calls).toHaveLength(2);
  });

  test("resolveTask refreshes index when first resolution is ambiguous", async () => {
    let listCalls = 0;
    const cache = new TaskIndexCache(async () => {
      listCalls += 1;
      if (listCalls === 1) {
        return [
          makeTask({ id: "alpha-wsp", title: "Alpha" }),
          makeTask({ id: "beta-wsp", title: "Beta" }),
        ];
      }

      return [makeTask({ id: "alpha-wsp", title: "Alpha" })];
    });

    const resolved = await cache.resolveTask("wsp");

    expect(resolved.id).toBe("alpha-wsp");
    expect(listCalls).toBe(2);
  });

  test("resolveTask preserves not-found error after refresh", async () => {
    let listCalls = 0;
    const cache = new TaskIndexCache(async () => {
      listCalls += 1;
      return [makeTask({ id: "task-1", title: "Task 1" })];
    });

    await expect(cache.resolveTask("does-not-exist")).rejects.toThrow(
      "Task not found: does-not-exist",
    );
    expect(listCalls).toBe(2);
  });
});
