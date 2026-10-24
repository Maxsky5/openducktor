import { describe, expect, test } from "bun:test";
import { repoConfigSchema, type WorkspaceSession } from "@openducktor/contracts";
import { Deferred, Effect, Fiber } from "effect";
import {
  createGitPortTestDouble,
  createSettingsConfigTestDouble,
  createWorktreeFilePortTestDouble,
} from "../../test-support/service-test-doubles";
import type { WorkspaceFilesService } from "../filesystem/workspace-files-service";
import { createTaskSessionLifecycleCoordinator } from "../tasks/worktrees/task-session-lifecycle-coordinator";
import {
  createWorkspaceSessionFileAccess,
  scopeFilesToChats,
} from "./workspace-session-file-access";
import { HostValidationError } from "../../effect/host-errors";

const repoPath = "/repo";
const worktree = "/worktrees/shared";
const ref = { workspaceId: "fairnest", sessionId: "chat-1" };

const session: WorkspaceSession = {
  id: ref.sessionId,
  runtimeKind: "opencode",
  externalSessionId: null,
  executionTarget: {
    kind: "local_worktree",
    workingDirectory: worktree,
    branchName: "feature",
    worktreeState: "present",
  },
  roleSnapshot: null,
  selectedModel: null,
  generatedTitle: null,
  manualTitle: null,
  targetBranch: null,
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
};

const setup = (chat: WorkspaceSession = session) => {
  const state = {
    existing: new Set([repoPath, worktree]),
    registered: new Set([worktree]),
  };
  const lifecycle = createTaskSessionLifecycleCoordinator();
  const access = createWorkspaceSessionFileAccess({
    settings: {
      getRepoConfig: () =>
        Effect.succeed(
          repoConfigSchema.parse({ workspaceId: "fairnest", workspaceName: "Fairnest", repoPath }),
        ),
    },
    store: { get: () => Effect.succeed(chat) },
    git: createGitPortTestDouble({
      canonicalizePath: (value) => Effect.succeed(value.replace(/\/$/, "")),
      readCheckout: (value) =>
        Effect.succeed(
          state.existing.has(value) ? { root: value, commonDirectory: "/repo/.git" } : null,
        ),
      isRegisteredWorktree: (_repo, value) => Effect.succeed(state.registered.has(value)),
    }),
    settingsConfig: createSettingsConfigTestDouble({
      pathExists: (value) => Effect.succeed(state.existing.has(value)),
    }),
    worktreeFiles: createWorktreeFilePortTestDouble({
      resolveWorktreeRemovalPath: (value) => Effect.succeed(value),
    }),
    lifecycle,
  });
  return { access, lifecycle, state };
};

describe("Workspace Session file access", () => {
  test("runs a request rooted at the saved chat directory", async () => {
    const h = setup();
    expect(await Effect.runPromise(h.access(ref, `${worktree}/`, Effect.succeed("read")))).toBe(
      "read",
    );
  });

  test.each([
    {
      name: "a root outside the chat directory",
      change: () => {},
      rootPath: "/worktrees/other",
      message: "/worktrees/other is not the directory of this chat",
    },
    {
      name: "a missing directory",
      change: (h: ReturnType<typeof setup>) => h.state.existing.delete(worktree),
      rootPath: worktree,
      message: `The directory of this chat is missing: ${worktree}. Recreate the worktree at this path, or archive this chat.`,
    },
    {
      name: "a directory that is no longer a registered worktree",
      change: (h: ReturnType<typeof setup>) => h.state.registered.delete(worktree),
      rootPath: worktree,
      message: `The directory of this chat is not a registered worktree of ${repoPath}: ${worktree}. If you moved this worktree, run git worktree repair in it.`,
    },
  ])("rejects $name before any file I/O", async ({ change, rootPath, message }) => {
    const h = setup();
    change(h);
    let ran = false;
    const failure = await Effect.runPromise(
      Effect.flip(
        h.access(
          ref,
          rootPath,
          Effect.sync(() => {
            ran = true;
          }),
        ),
      ),
    );
    expect(failure.message).toContain(message);
    expect(ran).toBe(false);
  });

  test("tells a Current checkout chat to restore its missing repository", async () => {
    const h = setup({
      ...session,
      executionTarget: { kind: "local_repo_root", workingDirectory: repoPath },
    });
    h.state.existing.delete(repoPath);
    const failure = await Effect.runPromise(Effect.flip(h.access(ref, repoPath, Effect.void)));
    expect(failure.message).toBe(
      `The repository of this chat is missing: ${repoPath}. Restore the repository at this path, or archive this chat.`,
    );
  });

  test("waits for an archive removal of the chat directory before file I/O", async () => {
    const h = setup();
    const removing = Effect.runSync(Deferred.make<void>());
    const archive = Effect.runFork(
      Effect.scoped(
        h.lifecycle
          .acquireWorktreeLifecycle([worktree])
          .pipe(Effect.andThen(Deferred.await(removing))),
      ),
    );
    let ran = false;
    const read = Effect.runFork(
      h.access(
        ref,
        worktree,
        Effect.sync(() => {
          ran = true;
        }),
      ),
    );
    await Effect.runPromise(Effect.yieldNow);
    expect(ran).toBe(false);
    h.state.existing.delete(worktree);
    await Effect.runPromise(Deferred.succeed(removing, undefined));
    await Effect.runPromise(Fiber.join(archive));
    const failure = await Effect.runPromise(Effect.flip(Fiber.join(read)));
    expect(failure.message).toContain("The directory of this chat is missing");
    expect(ran).toBe(false);
  });
});

describe("Workspace files scoped to chats", () => {
  const files: WorkspaceFilesService = {
    dispose: () => Effect.void,
    refreshTree: () => Effect.die(new Error("Unexpected tree refresh")),
    listTree: () => Effect.die(new Error("Unexpected tree list")),
    readTextFile: () => Effect.die(new Error("Unexpected file read")),
    writeTextFile: () => Effect.die(new Error("Unexpected file write")),
  };

  test("rejects a save to a missing chat directory before the write", async () => {
    const h = setup();
    h.state.existing.delete(worktree);
    const failure = await Effect.runPromise(
      Effect.flip(
        scopeFilesToChats(files, h.access).writeTextFile({
          scope: { kind: "chat", session: ref },
          rootPath: worktree,
          relativePath: "notes.md",
          contents: "text",
          revision: "1",
        }),
      ),
    );
    expect(failure).toBeInstanceOf(HostValidationError);
    expect(failure.message).toBe(
      `The directory of this chat is missing: ${worktree}. Recreate the worktree at this path, or archive this chat.`,
    );
  });
});
