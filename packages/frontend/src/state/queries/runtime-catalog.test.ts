import { describe, expect, mock, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type {
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentRuntimeCatalog,
  AgentSkillCatalog,
  AgentSlashCommandCatalog,
  RuntimeWorkingDirectoryRef,
} from "@openducktor/core";
import { QueryClient, skipToken } from "@tanstack/react-query";
import { SKIPPED_QUERY_KEY_SEGMENT } from "./skipped-query";
import {
  loadRuntimeCatalogFromQuery,
  refreshRuntimeCatalogIfStale,
  repoRuntimeFileSearchQueryOptions,
  resolveRuntimeCatalogSurface,
  retryRuntimeCatalog,
  runtimeCatalogQueryKeys,
  runtimeCatalogQueryOptions,
  skippedRuntimeCatalogQueryOptions,
} from "./runtime-catalog";

const workingDirectoryRefFixture: RuntimeWorkingDirectoryRef = {
  repoPath: "/repo",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
};

const modelCatalogFixture: AgentModelCatalog = {
  runtime: OPENCODE_RUNTIME_DESCRIPTOR,
  models: [],
  profiles: [],
  defaultModelsByProvider: {},
};

const slashCommandCatalogFixture: AgentSlashCommandCatalog = {
  commands: [],
};

const skillCatalogFixture: AgentSkillCatalog = {
  skills: [],
};

const runtimeCatalogFixture: AgentRuntimeCatalog = {
  runtime: OPENCODE_RUNTIME_DESCRIPTOR,
  models: { status: "available", catalog: modelCatalogFixture },
  slashCommands: { status: "available", catalog: slashCommandCatalogFixture },
  skills: { status: "available", catalog: skillCatalogFixture },
};

const fileSearchFixture: AgentFileSearchResult = {
  id: "src/index.ts",
  path: "src/index.ts",
  name: "index.ts",
  kind: "code",
};

describe("runtime catalog queries", () => {
  test("keys the combined catalog read by repo path, runtime kind, and working directory", () => {
    expect(runtimeCatalogQueryKeys.catalog(workingDirectoryRefFixture)).toEqual([
      "runtime-catalog",
      "catalog",
      "/repo",
      "opencode",
      "/repo/worktree",
    ]);
  });

  test("scopes invalidation to one runtime directory or to every directory of a runtime", () => {
    expect(
      runtimeCatalogQueryKeys.runtimeCatalogScope({
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
      }),
    ).toEqual(["runtime-catalog", "catalog", "/repo", "opencode", "/repo/worktree"]);
    expect(
      runtimeCatalogQueryKeys.runtimeCatalogScope({
        repoPath: "/repo",
        runtimeKind: "opencode",
      }),
    ).toEqual(["runtime-catalog", "catalog", "/repo", "opencode"]);
    expect(runtimeCatalogQueryKeys.repoCatalogScope("/repo")).toEqual([
      "runtime-catalog",
      "catalog",
      "/repo",
    ]);
  });

  test("loads the combined catalog once for a runtime working directory", async () => {
    const queryClient = new QueryClient();
    const loadCatalog = mock(async () => runtimeCatalogFixture);

    const catalog = await queryClient.fetchQuery(
      runtimeCatalogQueryOptions(workingDirectoryRefFixture, loadCatalog),
    );

    expect(catalog).toBe(runtimeCatalogFixture);
    expect(loadCatalog).toHaveBeenCalledWith(workingDirectoryRefFixture);
  });

  test("loads the combined catalog through the imperative query helper", async () => {
    const queryClient = new QueryClient();
    const loadCatalog = mock(async () => runtimeCatalogFixture);

    const catalog = await loadRuntimeCatalogFromQuery(
      queryClient,
      workingDirectoryRefFixture,
      loadCatalog,
    );

    expect(catalog).toBe(runtimeCatalogFixture);
    expect(loadCatalog).toHaveBeenCalledTimes(1);
  });

  test("projects an available surface", () => {
    expect(resolveRuntimeCatalogSurface(runtimeCatalogFixture.models, null)).toEqual({
      catalog: modelCatalogFixture,
      error: null,
    });
  });

  test("projects a failed surface message", () => {
    expect(
      resolveRuntimeCatalogSurface(
        { status: "failed", message: "Claude could not load skill catalog." },
        null,
      ),
    ).toEqual({ catalog: null, error: "Claude could not load skill catalog." });
  });

  test("keeps a retained surface and reports the request failure", () => {
    expect(
      resolveRuntimeCatalogSurface(runtimeCatalogFixture.models, new Error("Refetch failed.")),
    ).toEqual({ catalog: modelCatalogFixture, error: "Refetch failed." });
  });

  test("uses the query error when the whole catalog request failed", () => {
    expect(resolveRuntimeCatalogSurface(undefined, new Error("Runtime is unavailable."))).toEqual({
      catalog: null,
      error: "Runtime is unavailable.",
    });
  });

  test("reports no error for a surface the runtime does not support", () => {
    expect(resolveRuntimeCatalogSurface(undefined, null)).toEqual({ catalog: null, error: null });
  });

  test("searches files only for a concrete runtime working-directory ref", async () => {
    const queryClient = new QueryClient();
    const searchFiles = mock(async () => [fileSearchFixture]);

    const results = await queryClient.fetchQuery(
      repoRuntimeFileSearchQueryOptions(workingDirectoryRefFixture, "index", searchFiles),
    );

    expect(results).toEqual([fileSearchFixture]);
    expect(searchFiles).toHaveBeenCalledWith(workingDirectoryRefFixture, "index");
  });

  test("keeps the skipped catalog read on a dedicated skipToken key", () => {
    const skippedOptions = skippedRuntimeCatalogQueryOptions();
    const liveKeys = [
      runtimeCatalogQueryKeys.catalog(workingDirectoryRefFixture),
      runtimeCatalogQueryKeys.runtimeCatalogScope({ repoPath: "/repo", runtimeKind: "opencode" }),
      runtimeCatalogQueryKeys.repoFileSearch(workingDirectoryRefFixture, "index"),
    ];

    expect(skippedOptions.queryFn).toBe(skipToken);
    expect(skippedOptions.queryKey[1]).toBe(SKIPPED_QUERY_KEY_SEGMENT);
    for (const key of liveKeys) {
      expect(key[1]).not.toBe(SKIPPED_QUERY_KEY_SEGMENT);
    }
  });

  test("reloads the complete catalog when a surface retry runs", async () => {
    const queryClient = new QueryClient();
    const queryKey = runtimeCatalogQueryKeys.catalog(workingDirectoryRefFixture);
    queryClient.setQueryData(queryKey, runtimeCatalogFixture);
    const refreshedCatalog: AgentRuntimeCatalog = {
      runtime: OPENCODE_RUNTIME_DESCRIPTOR,
      models: { status: "available", catalog: modelCatalogFixture },
      slashCommands: { status: "available", catalog: slashCommandCatalogFixture },
      skills: { status: "available", catalog: skillCatalogFixture },
    };
    const loadCatalog = mock(async () => refreshedCatalog);

    await retryRuntimeCatalog({
      queryClient,
      runtimeRef: workingDirectoryRefFixture,
      loadRuntimeCatalog: loadCatalog,
    });

    expect(loadCatalog).toHaveBeenCalledWith(workingDirectoryRefFixture);
    expect(queryClient.getQueryData<AgentRuntimeCatalog>(queryKey)).toEqual(refreshedCatalog);
  });

  test("replaces an invalidated entry with the new runtime catalog and clears invalidation", async () => {
    const queryClient = new QueryClient();
    const queryKey = runtimeCatalogQueryKeys.catalog(workingDirectoryRefFixture);
    const oldModelCatalog: AgentModelCatalog = {
      ...modelCatalogFixture,
      models: [],
      defaultModelsByProvider: { old: "old-model" },
    };
    queryClient.setQueryData(queryKey, {
      ...runtimeCatalogFixture,
      models: { status: "available", catalog: oldModelCatalog },
    });
    await queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "none" });
    const loadCatalog = mock(async () => runtimeCatalogFixture);

    await retryRuntimeCatalog({
      queryClient,
      runtimeRef: workingDirectoryRefFixture,
      loadRuntimeCatalog: loadCatalog,
    });

    const state = queryClient.getQueryState(queryKey);
    expect(loadCatalog).toHaveBeenCalledWith(workingDirectoryRefFixture);
    expect(state?.isInvalidated).toBe(false);
    expect(state?.status).toBe("success");
    expect(queryClient.getQueryData<AgentRuntimeCatalog>(queryKey)).toEqual(runtimeCatalogFixture);
  });

  test("forces a combined read on retry while the cached entry is fresh", async () => {
    const queryClient = new QueryClient();
    const queryKey = runtimeCatalogQueryKeys.catalog(workingDirectoryRefFixture);
    queryClient.setQueryData(queryKey, runtimeCatalogFixture);
    const loadCatalog = mock(async () => runtimeCatalogFixture);

    await retryRuntimeCatalog({
      queryClient,
      runtimeRef: workingDirectoryRefFixture,
      loadRuntimeCatalog: loadCatalog,
    });

    expect(loadCatalog).toHaveBeenCalledTimes(1);
  });

  test("reads the combined catalog when no entry exists to replace", async () => {
    const queryClient = new QueryClient();
    const loadCatalog = mock(async () => runtimeCatalogFixture);

    await retryRuntimeCatalog({
      queryClient,
      runtimeRef: workingDirectoryRefFixture,
      loadRuntimeCatalog: loadCatalog,
    });

    expect(loadCatalog).toHaveBeenCalledWith(workingDirectoryRefFixture);
    expect(
      queryClient.getQueryData<AgentRuntimeCatalog>(
        runtimeCatalogQueryKeys.catalog(workingDirectoryRefFixture),
      ),
    ).toBe(runtimeCatalogFixture);
  });

  test("keeps a whole-request retry failure in the query error path", async () => {
    const queryClient = new QueryClient();
    const queryKey = runtimeCatalogQueryKeys.catalog(workingDirectoryRefFixture);
    queryClient.setQueryData(queryKey, runtimeCatalogFixture);
    const loadCatalog = mock(async () => {
      throw new Error("The runtime changed during this read. Reload the runtime data.");
    });

    await retryRuntimeCatalog({
      queryClient,
      runtimeRef: workingDirectoryRefFixture,
      loadRuntimeCatalog: loadCatalog,
    });

    const state = queryClient.getQueryState(queryKey);
    expect(state?.status).toBe("error");
    expect(state?.error).toEqual(
      new Error("The runtime changed during this read. Reload the runtime data."),
    );
    expect(queryClient.getQueryData<AgentRuntimeCatalog>(queryKey)).toEqual(runtimeCatalogFixture);
  });

  test("refreshes a stale combined catalog and reuses a fresh entry", async () => {
    const queryClient = new QueryClient();
    const loadCatalog = mock(async () => runtimeCatalogFixture);
    const queryKey = runtimeCatalogQueryKeys.catalog(workingDirectoryRefFixture);
    queryClient.setQueryData(queryKey, runtimeCatalogFixture);

    refreshRuntimeCatalogIfStale(queryClient, workingDirectoryRefFixture, loadCatalog);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(loadCatalog).toHaveBeenCalledTimes(0);

    queryClient.setQueryData(queryKey, runtimeCatalogFixture, { updatedAt: 0 });
    refreshRuntimeCatalogIfStale(queryClient, workingDirectoryRefFixture, loadCatalog);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(loadCatalog).toHaveBeenCalledTimes(1);
  });
});
