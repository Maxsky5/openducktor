import { expect, test } from "bun:test";
import type { JsonValue, StartupOperationSnapshot } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../../effect/host-errors";
import { createModelNamingService } from "../../../test-support/naming-test-doubles";
import { repoConfigFixture } from "../../../test-support/repo-config-fixture";
import { createGitPortTestDouble } from "../../../test-support/service-test-doubles";
import {
  CurrentStartupProgress,
  createStartupProgressRecorder,
} from "../../agent-sessions/session-startup-progress";
import { nameTaskBranch } from "./task-branch-naming";

const task = { id: "task-1", title: "Fix login redirect", description: "After OAuth." };
const namingModel = { runtimeKind: "codex", providerId: "openai", modelId: "gpt-5-mini" } as const;

const nameTask = (answer: Effect.Effect<JsonValue, HostOperationError>, model = true) => {
  const { service, requests } = createModelNamingService(() => answer);
  const snapshots: StartupOperationSnapshot[] = [];
  const progress = createStartupProgressRecorder(
    {
      context: { startupAttemptId: "attempt", operationId: "operation" },
      hostInstanceId: "host",
      workspaceId: "workspace",
      repoPath: "/repo",
      scope: { kind: "workspace" },
    },
    (snapshot) => snapshots.push(snapshot),
    () => Effect.die("unused"),
    () => Effect.void,
  );
  const repoConfig = repoConfigFixture({ branchPrefix: "odt" });
  if (model) repoConfig.namingModel = namingModel;
  const branch = Effect.runPromise(
    nameTaskBranch(
      {
        naming: service,
        git: createGitPortTestDouble({
          listRemoteNames: () => Effect.succeed(["origin"]),
          listRefNames: () => Effect.succeed([]),
        }),
      },
      {
        repoConfig,
        repoPath: "/repo",
        task,
      },
    ).pipe(Effect.provideService(CurrentStartupProgress, progress)),
  );
  return { branch, requests, steps: () => snapshots.at(-1)?.steps ?? [] };
};

test("names the task branch from the task title and description on the naming step", async () => {
  const { branch, requests, steps } = nameTask(
    Effect.succeed({ branch: "fix/oauth-login-redirect" }),
  );
  expect(await branch).toBe("fix/oauth-login-redirect");
  expect(requests[0]?.prompt).toContain(
    "Task title: Fix login redirect\n\nTask description:\nAfter OAuth.",
  );
  expect(steps()).toMatchObject([
    { id: "naming", label: "Generate branch name", state: "completed", details: [] },
  ]);
});

test("shows a naming failure on the naming step and uses the task title branch", async () => {
  const { branch, steps } = nameTask(
    Effect.fail(new HostOperationError({ operation: "test", message: "Codex stopped." })),
  );
  expect(await branch).toBe("odt/task-1-fix-login-redirect");
  expect(steps()[0]?.details[0]).toContain("Codex stopped.");
});

test("has no naming step without a naming model", async () => {
  const { branch, requests, steps } = nameTask(Effect.succeed({ branch: "fix/login" }), false);
  expect(await branch).toBe("odt/task-1-fix-login-redirect");
  expect(requests).toEqual([]);
  expect(steps()).toEqual([]);
});
