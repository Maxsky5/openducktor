import { expect, test } from "bun:test";
import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import type { LoadAgentSessionHistoryInput } from "@openducktor/core";
import { Effect } from "effect";
import { loadClaudeHistory } from "./claude-agent-sdk-history-loader";
import { loadClaudeTodos } from "./claude-agent-sdk-todos";
import { createClaudeTranscriptReader } from "./claude-transcript-reader";

const sessionId = "00000000-0000-4000-8000-000000000001";
const timestamp = "2026-10-21T10:00:00.000Z";
type Storage = "memory" | "disk";
const storageModes: Storage[] = ["memory", "disk"];
type Fixture = {
  root: string;
  input: LoadAgentSessionHistoryInput;
  options: { processEnv: NodeJS.ProcessEnv; storage: Storage };
  transcript: string;
};

const withSavedTranscript = async (
  storage: Storage,
  run: (fixture: Fixture) => Promise<void>,
): Promise<void> => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "claude-removed-worktree-")));
  try {
    const workingDirectory = join(root, "worktrees", "task");
    const config = join(root, "config");
    const project = join(config, "projects", "saved-worktree");
    await mkdir(workingDirectory, { recursive: true });
    await mkdir(project, { recursive: true });
    const transcript = join(project, `${sessionId}.jsonl`);
    const base = { sessionId, cwd: workingDirectory, timestamp };
    await writeFile(
      transcript,
      [
        {
          ...base,
          type: "user",
          uuid: "saved-user",
          parentUuid: null,
          message: { role: "user", content: "Check the saved task" },
        },
        {
          ...base,
          type: "assistant",
          uuid: "saved-todo",
          parentUuid: "saved-user",
          message: {
            id: "saved-todo",
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "todo-call",
                name: "TaskCreate",
                input: { subject: "Check the saved task" },
              },
            ],
            stop_reason: "tool_use",
          },
        },
        {
          ...base,
          type: "user",
          uuid: "saved-result",
          parentUuid: "saved-todo",
          message: {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "todo-call", content: "Task created" }],
          },
          toolUseResult: { task: { id: "1", subject: "Check the saved task" } },
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n") + "\n",
    );
    await run({
      root,
      input: {
        repoPath: root,
        workingDirectory,
        externalSessionId: sessionId,
        runtimeKind: "claude",
        runtimePolicy: { kind: "claude" },
        sessionScope: { kind: "workflow", taskId: "task", role: "build" },
      },
      options: { processEnv: { CLAUDE_CONFIG_DIR: config }, storage },
      transcript,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

test.each(
  storageModes.flatMap(
    (storage) =>
      [
        [storage, "history"],
        [storage, "todos"],
      ] as const,
  ),
)(
  "restores saved workflow reads with %s storage through %s after worktree removal",
  async (storage, projection) => {
    await withSavedTranscript(storage, async ({ input, options }) => {
      await rm(dirname(input.workingDirectory), { recursive: true });
      const reader = createClaudeTranscriptReader(options);
      try {
        if (projection === "history") {
          const history = await Effect.runPromise(
            loadClaudeHistory(input, () => timestamp, undefined, { reader }),
          );
          expect(history.map((message) => [message.messageId, message.text])).toEqual([
            ["saved-user", "Check the saved task"],
            ["saved-todo", ""],
          ]);
          expect(history.flatMap((message) => message.parts)).toContainEqual(
            expect.objectContaining({
              callId: "todo-call",
              tool: "TaskCreate",
              status: "completed",
            }),
          );
        } else {
          const todos = await Effect.runPromise(loadClaudeTodos(input, { reader }));
          expect(todos).toEqual([
            { id: "1", content: "Check the saved task", status: "pending", priority: "medium" },
          ]);
        }
        for (const request of [
          { ...input, sessionScope: undefined },
          { ...input, sessionScope: { kind: "repository" } as const },
          { ...input, workingDirectory: relative(process.cwd(), input.workingDirectory) },
        ]) {
          const read =
            projection === "history"
              ? loadClaudeHistory(request, () => timestamp, undefined, { reader }).pipe(
                  Effect.asVoid,
                )
              : loadClaudeTodos(request, { reader }).pipe(Effect.asVoid);
          const failure = await Effect.runPromise(Effect.flip(read));
          expect(failure).toMatchObject({
            operation: "claude.transcript.resolve directory for",
            cause: { code: "ENOENT" },
          });
        }
      } finally {
        reader.dispose();
      }
    });
  },
);

test.each(storageModes)(
  "resolves existing workflow directory aliases with %s storage",
  async (storage) => {
    await withSavedTranscript(storage, async ({ root, input, options }) => {
      const alias = join(root, "worktree-alias");
      await symlink(
        input.workingDirectory,
        alias,
        process.platform === "win32" ? "junction" : "dir",
      );
      const history = await Effect.runPromise(
        loadClaudeHistory(
          { ...input, workingDirectory: alias },
          () => timestamp,
          undefined,
          options,
        ),
      );
      expect(history[0]?.text).toBe("Check the saved task");
    });
  },
);

test.each(storageModes)(
  "rejects a removed workflow transcript whose effective directory differs with %s storage",
  async (storage) => {
    await withSavedTranscript(storage, async ({ root, input, options, transcript }) => {
      await rm(dirname(input.workingDirectory), { recursive: true });
      await appendFile(
        transcript,
        JSON.stringify({ type: "relocated", sessionId, relocatedCwd: join(root, "other-task") }) +
          "\n",
      );
      for (const read of [
        loadClaudeHistory(input, () => timestamp, undefined, options).pipe(Effect.asVoid),
        loadClaudeTodos(input, options).pipe(Effect.asVoid),
      ]) {
        const failure = await Effect.runPromise(Effect.flip(read));
        expect(failure).toMatchObject({ code: "scope_mismatch" });
      }
    });
  },
);

test.each(storageModes)(
  "propagates non-missing workflow directory errors with %s storage",
  async (storage) => {
    await withSavedTranscript(storage, async ({ input, options }) => {
      await rm(dirname(input.workingDirectory), { recursive: true });
      await writeFile(dirname(input.workingDirectory), "The worktree parent is a file.");
      for (const read of [
        loadClaudeHistory(input, () => timestamp, undefined, options).pipe(Effect.asVoid),
        loadClaudeTodos(input, options).pipe(Effect.asVoid),
      ]) {
        const failure = await Effect.runPromise(Effect.flip(read));
        expect(failure).toMatchObject({
          operation: "claude.transcript.resolve directory for",
          cause: { code: "ENOTDIR" },
        });
      }
    });
  },
);

test.skipIf(process.platform === "win32" || process.getuid?.() === 0).each(storageModes)(
  "propagates inaccessible workflow directory errors with %s storage",
  async (storage) => {
    await withSavedTranscript(storage, async ({ input, options }) => {
      const worktrees = dirname(input.workingDirectory);
      await chmod(worktrees, 0);
      try {
        for (const read of [
          loadClaudeHistory(input, () => timestamp, undefined, options).pipe(Effect.asVoid),
          loadClaudeTodos(input, options).pipe(Effect.asVoid),
        ]) {
          const failure = await Effect.runPromise(Effect.flip(read));
          expect(failure).toMatchObject({
            operation: "claude.transcript.resolve directory for",
            cause: { code: "EACCES" },
          });
        }
      } finally {
        await chmod(worktrees, 0o700);
      }
    });
  },
);
