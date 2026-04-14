import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { BuildContinuationTarget } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { buildContinuationTargetQueryOptions, buildRuntimeQueryKeys } from "./build-runtime";

describe("build runtime queries", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
  });

  test("uses a repo and task scoped query key for continuation targets", () => {
    expect(buildRuntimeQueryKeys.continuationTarget("/repo", "task-24")).toEqual([
      "build-runtime",
      "continuation-target",
      "/repo",
      "task-24",
    ]);
  });

  test("buildContinuationTargetQueryOptions loads the canonical working directory", async () => {
    const buildContinuationTargetGet = mock(
      async (): Promise<BuildContinuationTarget> => ({
        workingDirectory: "/repo/.worktrees/task-24",
        source: "active_build_run",
      }),
    );

    const result = await queryClient.fetchQuery(
      buildContinuationTargetQueryOptions("/repo", "task-24", {
        buildContinuationTargetGet,
      }),
    );

    expect(result).toEqual({
      workingDirectory: "/repo/.worktrees/task-24",
      source: "active_build_run",
    });
    expect(buildContinuationTargetGet).toHaveBeenCalledWith("/repo", "task-24");
  });
});
