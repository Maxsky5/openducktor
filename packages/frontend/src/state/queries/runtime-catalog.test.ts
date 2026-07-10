import { describe, expect, mock, test } from "bun:test";
import type { RepoRuntimeRef } from "@openducktor/contracts";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type {
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentSkillCatalog,
  AgentSlashCommandCatalog,
  RuntimeWorkingDirectoryRef,
} from "@openducktor/core";
import { QueryClient } from "@tanstack/react-query";
import {
  repoRuntimeCatalogQueryOptions,
  repoRuntimeFileSearchQueryOptions,
  repoRuntimeSkillsQueryOptions,
  repoRuntimeSlashCommandsQueryOptions,
  runtimeCatalogQueryKeys,
  sessionStartRuntimeCatalogQueryOptions,
} from "./runtime-catalog";

const repoRuntimeRefFixture: RepoRuntimeRef = {
  repoPath: "/repo",
  runtimeKind: "opencode",
};

const workingDirectoryRefFixture: RuntimeWorkingDirectoryRef = {
  ...repoRuntimeRefFixture,
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

const fileSearchFixture: AgentFileSearchResult = {
  id: "src/index.ts",
  path: "src/index.ts",
  name: "index.ts",
  kind: "code",
};

describe("runtime catalog queries", () => {
  test("keys runtime catalog reads by a concrete repo runtime ref", async () => {
    const queryClient = new QueryClient();
    const loadCatalog = mock(async () => modelCatalogFixture);

    const catalog = await queryClient.fetchQuery(
      repoRuntimeCatalogQueryOptions(repoRuntimeRefFixture, loadCatalog),
    );

    expect(runtimeCatalogQueryKeys.repo("/repo", "opencode")).toEqual([
      "runtime-catalog",
      "/repo",
      "opencode",
    ]);
    expect(catalog).toBe(modelCatalogFixture);
    expect(loadCatalog).toHaveBeenCalledWith(repoRuntimeRefFixture);
  });

  test("loads slash commands only for a concrete runtime working-directory ref", async () => {
    const queryClient = new QueryClient();
    const loadSlashCommands = mock(async () => slashCommandCatalogFixture);

    const catalog = await queryClient.fetchQuery(
      repoRuntimeSlashCommandsQueryOptions(workingDirectoryRefFixture, loadSlashCommands),
    );

    expect(runtimeCatalogQueryKeys.repoSlashCommands(workingDirectoryRefFixture)).toEqual([
      "runtime-catalog",
      "slash-commands",
      "/repo",
      "opencode",
      "/repo/worktree",
    ]);
    expect(catalog).toBe(slashCommandCatalogFixture);
    expect(loadSlashCommands).toHaveBeenCalledWith(workingDirectoryRefFixture);
  });

  test("uses a fresh session-start runtime catalog query key", async () => {
    const queryClient = new QueryClient();
    const loadCatalog = mock(async () => modelCatalogFixture);

    const catalog = await queryClient.fetchQuery(
      sessionStartRuntimeCatalogQueryOptions(repoRuntimeRefFixture, loadCatalog),
    );

    expect(runtimeCatalogQueryKeys.repoSessionStart("/repo/", "opencode")).toEqual([
      "runtime-catalog",
      "session-start",
      "/repo",
      "opencode",
    ]);
    expect(catalog).toBe(modelCatalogFixture);
    expect(loadCatalog).toHaveBeenCalledWith(repoRuntimeRefFixture);
  });

  test("loads skills only for a concrete runtime working-directory ref", async () => {
    const queryClient = new QueryClient();
    const loadSkills = mock(async () => skillCatalogFixture);

    const catalog = await queryClient.fetchQuery(
      repoRuntimeSkillsQueryOptions(workingDirectoryRefFixture, loadSkills),
    );

    expect(catalog).toBe(skillCatalogFixture);
    expect(loadSkills).toHaveBeenCalledWith(workingDirectoryRefFixture);
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
});
