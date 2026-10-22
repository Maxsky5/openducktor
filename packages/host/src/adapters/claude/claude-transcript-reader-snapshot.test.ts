import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const storageModes: Array<"memory" | "disk"> = ["memory", "disk"];

const runReader = async (
  storage: (typeof storageModes)[number],
  scenario: string,
): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "claude-transcript-snapshot-"));
  try {
    const cwd = await realpath(root);
    const config = join(cwd, "config");
    const project = join(config, "projects", "native-project");
    await mkdir(project, { recursive: true });
    // A child process keeps native file observers out of parallel host tests.
    const worker = Bun.spawn(
      [
        process.execPath,
        "--eval",
        String.raw`
          import assert from "node:assert/strict";
          import fs from "node:fs/promises";
          import { join } from "node:path";
          import { mock } from "bun:test";
          const cwd = process.env.ODT_READER_CWD;
          const project = process.env.ODT_READER_PROJECT;
          const sessionId = "00000000-0000-4000-8000-000000000001";
          const transcript = join(project, sessionId + ".jsonl");
          const input = {
            repoPath: cwd, workingDirectory: cwd, externalSessionId: sessionId,
            runtimeKind: "claude", runtimePolicy: { kind: "claude" },
          };
          const row = (uuid, content, extra = {}) => ({
            type: "user", sessionId, cwd, uuid, parentUuid: null,
            timestamp: "2026-10-21T10:00:00.000Z",
            message: { role: "user", content }, ...extra,
          });
          const write = (rows, path = transcript) =>
            fs.writeFile(path, rows.map(value => JSON.stringify(value)).join("\n") + "\n");
          let sourceReads = 0;
          let afterSourceRead;
          let denySource = false;
          const originalOpen = fs.open;
          fs.open = async (...args) => {
            const path = String(args[0]);
            if (path === transcript && denySource)
              throw Object.assign(new Error("Permission denied"), { code: "EACCES" });
            const file = await originalOpen(...args);
            if (path.startsWith(project)) {
              const originalRead = file.read.bind(file);
              file.read = async (...readArgs) => {
                const result = await originalRead(...readArgs);
                sourceReads++;
                await afterSourceRead?.();
                return result;
              };
            }
            return file;
          };
          mock.module("node:fs/promises", () => ({ ...fs }));
          const { Effect, Result } = await import("effect");
          const { createClaudeTranscriptReader } = await import(process.env.ODT_READER_MODULE);
          const processEnv = { CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR };
          const reader = createClaudeTranscriptReader({ processEnv, storage: process.env.ODT_READER_STORAGE });
          const read = (request = input) => Effect.runPromise(reader.read(request));
          const readFailure = async (request = input) => {
            const result = await Effect.runPromise(Effect.result(reader.read(request)));
            assert.ok(Result.isFailure(result), "The source read must fail.");
            return result.failure;
          };
          try {
            ${scenario}
          } finally {
            reader.dispose();
          }
        `,
      ],
      {
        cwd: import.meta.dir,
        env: {
          ...process.env,
          CLAUDE_CONFIG_DIR: config,
          ODT_READER_CWD: cwd,
          ODT_READER_PROJECT: project,
          ODT_READER_STORAGE: storage,
          ODT_READER_MODULE: new URL("./claude-transcript-reader.ts", import.meta.url).href,
        },
        stdout: "pipe",
        stderr: "pipe",
        timeout: 4_000,
        killSignal: "SIGKILL",
      },
    );
    try {
      const [output, error, code] = await Promise.all([
        new Response(worker.stdout).text(),
        new Response(worker.stderr).text(),
        worker.exited,
      ]);
      expect({ code, error, output }).toEqual({ code: 0, error: "", output: "" });
    } finally {
      worker.kill();
      await worker.exited;
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

describe("Claude source snapshot reuse", () => {
  test.each(storageModes)(
    "reuses only the most recent unchanged source and keeps its environment with %s storage",
    async (storage) => {
      await runReader(
        storage,
        String.raw`
        await write([row("first", "Original message")]);
        processEnv.CLAUDE_CONFIG_DIR = join(cwd, "not-the-native-config");
        const { loadClaudeTodos } = await import(new URL("./claude-agent-sdk-todos.ts", process.env.ODT_READER_MODULE).href);
        const { loadClaudeHistory } = await import(new URL("./claude-agent-sdk-history-loader.ts", process.env.ODT_READER_MODULE).href);
        assert.deepEqual(await Effect.runPromise(loadClaudeTodos(input, { reader })), []);
        const firstReads = sourceReads;
        assert.ok(firstReads > 0);
        const history = await Effect.runPromise(loadClaudeHistory(input, () => "2026-10-21T10:00:00.000Z", undefined, { reader }));
        assert.equal(history[0].text, "Original message");
        assert.equal((await read()).messages[0].uuid, "first");
        assert.equal(sourceReads, firstReads, "A sequential read must not parse unchanged bytes again.");
        const otherId = "00000000-0000-4000-8000-000000000002";
        await write([row("other", "Other session", { sessionId: otherId })], join(project, otherId + ".jsonl"));
        assert.equal((await read({ ...input, externalSessionId: otherId })).messages[0].uuid, "other");
        const otherReads = sourceReads;
        await read();
        assert.ok(sourceReads > otherReads, "Reading another source must evict the previous snapshot.");
        reader.dispose();
        const closedReads = sourceReads;
        assert.match((await readFailure()).message, /closed/);
        assert.equal(sourceReads, closedReads);
      `,
      );
    },
  );

  test.each(storageModes)(
    "rechecks both root scope and selected child discovery with %s storage",
    async (storage) => {
      await runReader(
        storage,
        String.raw`
        const { claudeSubagentExternalSessionId } = await import(new URL("./claude-agent-sdk-subagent-transcripts.ts", process.env.ODT_READER_MODULE).href);
        await write([row("root", "Root session")]);
        const children = join(project, sessionId, "subagents");
        await fs.mkdir(children, { recursive: true });
        const childPath = join(children, "agent-child.jsonl");
        const childInput = { ...input, externalSessionId: claudeSubagentExternalSessionId(sessionId, "child") };
        const child = row("child", "Child message", { isSidechain: true });
        await write([child], childPath);
        assert.equal((await read(childInput)).messages[0].uuid, "child");
        const cachedReads = sourceReads;
        await read(childInput);
        assert.equal(sourceReads, cachedReads);
        await write([row("root", "Changed scope", { cwd: join(cwd, "other-directory") })]);
        assert.equal((await readFailure(childInput)).code, "scope_mismatch");
        await write([row("root", "Root session")]);
        await read(childInput);
        const duplicate = join(children, "nested");
        await fs.mkdir(duplicate);
        await write([child], join(duplicate, "agent-child.jsonl"));
        assert.match((await readFailure(childInput)).message, /Multiple Claude subagent transcripts/);
      `,
      );
    },
  );

  test.each(storageModes)(
    "refreshes appended and same-size rewritten source records with %s storage",
    async (storage) => {
      await runReader(
        storage,
        String.raw`
        await write([row("first", "Original message")]);
        await read();
        await fs.appendFile(transcript, JSON.stringify(row("second", "Appended message", { parentUuid: "first" })) + "\n");
        assert.deepEqual((await read()).messages.map(message => message.uuid), ["first", "second"]);
        const size = (await fs.stat(transcript)).size;
        await write([row("first", "Replaced message"), row("second", "Appended message", { parentUuid: "first" })]);
        assert.equal((await fs.stat(transcript)).size, size);
        assert.equal((await read()).messages[0].message.content, "Replaced message");
      `,
      );
    },
  );

  test.each(storageModes)(
    "evicts cached records when source access, scope, or discovery fails with %s storage",
    async (storage) => {
      await runReader(
        storage,
        String.raw`
        const original = row("first", "Original message");
        await write([original]);
        await read();
        denySource = true;
        assert.match((await readFailure()).message, /Permission denied/);
        denySource = false;
        const deniedReads = sourceReads;
        await read();
        assert.ok(sourceReads > deniedReads, "A failed access check must evict the old snapshot.");
        const otherDirectory = join(cwd, "other-directory");
        await fs.mkdir(otherDirectory);
        assert.equal((await readFailure({ ...input, workingDirectory: otherDirectory })).code, "scope_mismatch");
        await read();
        const duplicate = join(project, "..", "duplicate-project");
        await fs.mkdir(duplicate);
        await write([original], join(duplicate, sessionId + ".jsonl"));
        assert.match((await readFailure()).message, /Multiple Claude transcripts/);
        await fs.rm(duplicate, { recursive: true });
        const duplicateReads = sourceReads;
        await read();
        assert.ok(sourceReads > duplicateReads);
        await write([row("first", "Foreign scope", { cwd: otherDirectory })]);
        assert.equal((await readFailure()).code, "scope_mismatch");
        await write([original]);
        await read();
        await fs.rm(transcript);
        assert.match((await readFailure()).message, /unavailable/);
      `,
      );
    },
  );

  test.each(storageModes)(
    "does not retain a prefix when the source grows during a read with %s storage",
    async (storage) => {
      await runReader(
        storage,
        String.raw`
        await write([row("first", "Original message")]);
        afterSourceRead = async () => {
          afterSourceRead = undefined;
          await fs.appendFile(transcript, JSON.stringify(row("second", "Appended during read", { parentUuid: "first" })) + "\n");
        };
        assert.deepEqual((await read()).messages.map(message => message.uuid), ["first"]);
        const prefixReads = sourceReads;
        assert.deepEqual((await read()).messages.map(message => message.uuid), ["first", "second"]);
        assert.ok(sourceReads > prefixReads, "The changed source must be parsed again.");
        const completeReads = sourceReads;
        await read();
        assert.equal(sourceReads, completeReads);
      `,
      );
    },
  );
});
