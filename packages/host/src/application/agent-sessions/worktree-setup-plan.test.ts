import { expect, test } from "bun:test";
import type { StartupOperationSnapshot } from "@openducktor/contracts";
import { Effect } from "effect";
import { CurrentStartupProgress, createStartupProgressRecorder } from "./session-startup-progress";
import { planWorktreeSetup } from "./worktree-setup-plan";

test("a named branch plans the naming step and every setup step in one snapshot", () => {
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

  Effect.runSync(
    planWorktreeSetup({
      label: "Create task worktree",
      worktreePath: "/worktrees/task-1",
      branch: null,
      namingStep: { id: "naming", label: "Generate branch name" },
      upstreamRemote: "origin",
      repoConfig: { worktreeCopyPaths: [".env"], actions: { items: [], defaultActionId: null } },
    }).pipe(Effect.provideService(CurrentStartupProgress, progress)),
  );

  expect(snapshots).toHaveLength(1);
  expect(snapshots[0]?.steps.map(({ id, state, details }) => [id, state, details])).toEqual([
    ["naming", "pending", []],
    ["checkout", "pending", ["/worktrees/task-1"]],
    ["upstream", "pending", ["origin"]],
    ["copies", "pending", [".env"]],
  ]);
});
