import { expect, test } from "bun:test";
import { globalConfigSchema } from "@openducktor/contracts";
import { createReviewTaskWorkflow } from "@openducktor/workflows/test-support";
import { Effect } from "effect";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSharedSettingsFixture } from "../../test-support/shared-settings-fixture";
import { createSettingsConfigTestDouble } from "../../test-support/service-test-doubles";
import { singleTaskWorkflow } from "../../test-support/task-workflows";
import { withTaskWorkflowSettings } from "./task-workflow-settings";
import { repoConfigFixture } from "../../test-support/repo-config-fixture";

test("narrow reads keep workflow defaults and validate the selected workspace", async () => {
  const review = createReviewTaskWorkflow();
  const workflows = singleTaskWorkflow(review);
  const config = globalConfigSchema.parse({ version: 4 });
  const repo = repoConfigFixture({
    agentDefaults: {
      build: { runtimeKind: "codex", providerId: "openai", modelId: "model" },
    },
  });
  const settings = withTaskWorkflowSettings(
    createSettingsConfigTestDouble({
      readConfig: () => Effect.die("A narrow read must not load the full config."),
      readGlobalConfig: () => Effect.succeed(config),
      readRepoConfig: () => Effect.succeed(repo),
      readRepoConfigByRepoPath: () => Effect.succeed(repo),
    }),
    workflows,
  );

  const global = await Effect.runPromise(settings.readGlobalConfig());
  expect(global?.autopilot.rules).toContainEqual({
    workflowId: review.definition.id,
    eventId: "reviewRejected",
    actionIds: [],
  });
  for (const read of [
    settings.readRepoConfig("repo"),
    settings.readRepoConfigByRepoPath("/repo"),
  ]) {
    const result = await Effect.runPromise(Effect.result(read));
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure")
      expect(result.failure).toMatchObject({
        field: "workspaces.repo.agentDefaults.build",
      });
  }
});

test("workspace preference writes reject unknown workflow roles before saving", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "odt-workflow-preferences-"));
  const configPath = path.join(root, "config.json");
  const config = globalConfigSchema.parse({
    version: 4,
    workspaces: {
      repo: repoConfigFixture(),
    },
  });
  const fixture = await createSharedSettingsFixture({ configPath, config });
  try {
    const before = await readFile(configPath, "utf8");
    const settings = withTaskWorkflowSettings(
      fixture.settingsConfig,
      singleTaskWorkflow(createReviewTaskWorkflow()),
    );
    const result = await Effect.runPromise(
      Effect.result(
        settings.updateWorkspacePreferences("repo", () => ({
          openTaskIds: ["task"],
          activeTask: { taskId: "task", role: "not-a-role" },
        })),
      ),
    );
    expect(result._tag).toBe("Failure");
    expect(await readFile(configPath, "utf8")).toBe(before);
  } finally {
    await fixture.cleanup();
    await rm(root, { recursive: true, force: true });
  }
});
