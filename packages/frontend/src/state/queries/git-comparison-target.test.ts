import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { gitComparisonTargetQueryOptions } from "./git";

test("comparison target reads keep the working directory and target in their query keys", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const calls: Array<{ repoPath: string; workingDir: string; branch: string }> = [];
  const host = {
    gitGetComparisonTarget: async (
      repoPath: string,
      workingDir: string,
      target: { branch: string },
    ) => {
      calls.push({ repoPath, workingDir, branch: target.branch });
      return { kind: "available" as const, reference: target.branch };
    },
  };
  await client.fetchQuery(
    gitComparisonTargetQueryOptions("/repo", "/repo", { branch: "@{upstream}" }, host),
  );
  await client.fetchQuery(
    gitComparisonTargetQueryOptions("/repo", "/worktree", { branch: "main" }, host),
  );
  expect(calls).toEqual([
    { repoPath: "/repo", workingDir: "/repo", branch: "@{upstream}" },
    { repoPath: "/repo", workingDir: "/worktree", branch: "main" },
  ]);
  const cached: unknown = client.getQueryData(
    gitComparisonTargetQueryOptions("/repo", "/repo", { branch: "@{upstream}" }, host).queryKey,
  );
  expect(cached).toEqual({ kind: "available", reference: "@{upstream}" });
});
