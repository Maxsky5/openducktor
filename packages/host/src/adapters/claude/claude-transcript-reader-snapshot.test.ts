import { describe, expect, spyOn, test } from "bun:test";
import type { ReadOptions, ReadOptionsWithBuffer, ReadPosition } from "node:fs";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import type { LoadAgentSessionHistoryInput } from "@openducktor/core";
import { Effect, Result } from "effect";
import { loadClaudeHistory } from "./claude-agent-sdk-history-loader";
import type { ClaudeProtocolObject } from "./claude-agent-sdk-ingress-schemas";
import { claudeSubagentExternalSessionId } from "./claude-agent-sdk-subagent-transcripts";
import { loadClaudeTodos } from "./claude-agent-sdk-todos";
import { createClaudeTranscriptReader } from "./claude-transcript-reader";

type Storage = "memory" | "disk";
type SourceObservation = { bytesRead: number; denied: boolean; afterRead?: () => Promise<void> };
const storageModes: Storage[] = ["memory", "disk"];
const sessionId = "00000000-0000-4000-8000-000000000001";
const timestamp = "2026-10-21T10:00:00.000Z";

const snapshotFixture = (cwd: string, project: string, storage: Storage) => {
  const transcript = join(project, `${sessionId}.jsonl`);
  const processEnv = { CLAUDE_CONFIG_DIR: join(cwd, "config") };
  const reader = createClaudeTranscriptReader({ processEnv, storage });
  const input: LoadAgentSessionHistoryInput = {
    repoPath: cwd,
    workingDirectory: cwd,
    externalSessionId: sessionId,
    runtimeKind: "claude",
    runtimePolicy: { kind: "claude" },
  };
  const row = (
    uuid: string,
    content: string,
    extra?: ClaudeProtocolObject,
  ): ClaudeProtocolObject => ({
    type: "user",
    sessionId,
    cwd,
    uuid,
    parentUuid: null,
    timestamp,
    message: { role: "user", content },
    ...extra,
  });
  const source: SourceObservation = { bytesRead: 0, denied: false };
  const write = (rows: ClaudeProtocolObject[], path = transcript) =>
    fs.writeFile(path, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  const read = (request = input) => Effect.runPromise(reader.read(request));
  const readFailure = async (request = input) => {
    const result = await Effect.runPromise(Effect.result(reader.read(request)));
    if (Result.isSuccess(result)) throw new Error("The source read must fail.");
    return result.failure;
  };

  return {
    cwd,
    project,
    transcript,
    processEnv,
    reader,
    input,
    row,
    source,
    write,
    read,
    readFailure,
  };
};

const withReader = async (
  storage: Storage,
  run: (fixture: ReturnType<typeof snapshotFixture>) => Promise<void>,
): Promise<void> => {
  const root = await fs.mkdtemp(join(tmpdir(), "claude-transcript-snapshot-"));
  try {
    const cwd = await fs.realpath(root);
    const project = join(cwd, "config", "projects", "native-project");
    await fs.mkdir(project, { recursive: true });
    const fixture = snapshotFixture(cwd, project, storage);
    const open = fs.open;
    const observe = spyOn(fs, "open").mockImplementation(async (path, flags, mode) => {
      if (path === fixture.transcript && fixture.source.denied)
        throw Object.assign(new Error("Permission denied"), { code: "EACCES" });
      const handle = await open(path, flags, mode);
      if (String(path).startsWith(project + sep)) {
        const read = handle.read.bind(handle);
        handle.read = async <T extends NodeJS.ArrayBufferView>(
          buffer?: T | ReadOptionsWithBuffer<T>,
          offset?: number | null | ReadOptions,
          length?: number | null,
          position?: ReadPosition | null,
        ) => {
          let result;
          if (!ArrayBuffer.isView(buffer)) result = await read(buffer);
          else if (offset instanceof Object) result = await read(buffer, offset);
          else result = await read(buffer, offset, length, position);
          fixture.source.bytesRead += result.bytesRead;
          if (result.bytesRead !== 0) await fixture.source.afterRead?.();
          return result;
        };
      }
      return handle;
    });
    try {
      await run(fixture);
    } finally {
      observe.mockRestore();
      fixture.reader.dispose();
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
};

describe("Claude source snapshot reuse", () => {
  test.each(storageModes)(
    "reuses only the most recent unchanged source and keeps its environment with %s storage",
    async (storage) => {
      await withReader(
        storage,
        async ({
          cwd,
          project,
          processEnv,
          reader,
          input,
          row,
          source,
          write,
          read,
          readFailure,
        }) => {
          await write([row("first", "Original message")]);
          processEnv.CLAUDE_CONFIG_DIR = join(cwd, "not-the-native-config");
          expect(await Effect.runPromise(loadClaudeTodos(input, { reader }))).toEqual([]);
          const firstReads = source.bytesRead;
          expect(firstReads).toBeGreaterThan(0);
          const history = await Effect.runPromise(
            loadClaudeHistory(input, () => timestamp, undefined, { reader }),
          );
          expect(history[0]?.text).toBe("Original message");
          expect((await read()).messages[0]?.uuid).toBe("first");
          expect(source.bytesRead).toBe(firstReads);

          const otherId = "00000000-0000-4000-8000-000000000002";
          await write(
            [row("other", "Other session", { sessionId: otherId })],
            join(project, otherId + ".jsonl"),
          );
          expect((await read({ ...input, externalSessionId: otherId })).messages[0]?.uuid).toBe(
            "other",
          );
          const otherReads = source.bytesRead;
          expect((await read()).messages[0]?.uuid).toBe("first");
          expect(source.bytesRead).toBeGreaterThan(otherReads);

          reader.dispose();
          const closedReads = source.bytesRead;
          expect((await readFailure()).message).toContain("closed");
          expect(source.bytesRead).toBe(closedReads);
        },
      );
    },
  );

  test("rechecks both root scope and selected child discovery", async () => {
    await withReader(
      "disk",
      async ({ cwd, project, input, row, source, write, read, readFailure }) => {
        await write([row("root", "Root session")]);
        const children = join(project, sessionId, "subagents");
        await fs.mkdir(children, { recursive: true });
        const childPath = join(children, "agent-child.jsonl");
        const childInput = {
          ...input,
          externalSessionId: claudeSubagentExternalSessionId(sessionId, "child"),
        };
        const child = row("child", "Child message", { isSidechain: true });
        await write([child], childPath);
        expect((await read(childInput)).messages[0]?.uuid).toBe("child");
        const cachedReads = source.bytesRead;
        await read(childInput);
        expect(source.bytesRead).toBe(cachedReads);

        await write([row("root", "Changed scope", { cwd: join(cwd, "other-directory") })]);
        expect(await readFailure(childInput)).toMatchObject({ code: "scope_mismatch" });
        await write([row("root", "Root session")]);
        await read(childInput);
        const duplicate = join(children, "nested");
        await fs.mkdir(duplicate);
        await write([child], join(duplicate, "agent-child.jsonl"));
        expect((await readFailure(childInput)).message).toContain(
          "Multiple Claude subagent transcripts",
        );
      },
    );
  });

  test("refreshes appended and same-size rewritten source records", async () => {
    await withReader("memory", async ({ transcript, row, write, read }) => {
      const second = row("second", "Appended message", { parentUuid: "first" });
      await write([row("first", "Original message")]);
      await read();
      await fs.appendFile(transcript, JSON.stringify(second) + "\n");
      expect((await read()).messages.map((message) => message.uuid)).toEqual(["first", "second"]);
      const size = (await fs.stat(transcript)).size;
      await write([row("first", "Replaced message"), second]);
      // A file system can keep one write time for writes within one clock tick, as NTFS does.
      // A rewrite by Claude comes later than the read, so it gets a later time.
      const later = new Date(Date.now() + 2_000);
      await fs.utimes(transcript, later, later);
      expect((await fs.stat(transcript)).size).toBe(size);
      expect((await read()).messages[0]?.message).toMatchObject({ content: "Replaced message" });
    });
  });

  test("evicts cached records when source access, scope, or discovery fails", async () => {
    await withReader(
      "disk",
      async ({ cwd, project, transcript, input, row, source, write, read, readFailure }) => {
        const original = row("first", "Original message");
        await write([original]);
        await read();
        source.denied = true;
        expect((await readFailure()).message).toContain("Permission denied");
        source.denied = false;
        const deniedReads = source.bytesRead;
        await read();
        expect(source.bytesRead).toBeGreaterThan(deniedReads);

        const otherDirectory = join(cwd, "other-directory");
        await fs.mkdir(otherDirectory);
        expect(await readFailure({ ...input, workingDirectory: otherDirectory })).toMatchObject({
          code: "scope_mismatch",
        });
        await read();
        const duplicate = join(project, "..", "duplicate-project");
        await fs.mkdir(duplicate);
        await write([original], join(duplicate, sessionId + ".jsonl"));
        expect((await readFailure()).message).toContain("Multiple Claude transcripts");
        await fs.rm(duplicate, { recursive: true });
        const duplicateReads = source.bytesRead;
        await read();
        expect(source.bytesRead).toBeGreaterThan(duplicateReads);

        await write([row("first", "Foreign scope", { cwd: otherDirectory })]);
        expect(await readFailure()).toMatchObject({ code: "scope_mismatch" });
        await write([original]);
        await read();
        await fs.rm(transcript);
        expect((await readFailure()).message).toContain("unavailable");
      },
    );
  });

  test("reloads rows appended during a bounded source read", async () => {
    await withReader("memory", async ({ transcript, row, source, write, read }) => {
      await write([row("first", "Original message")]);
      source.afterRead = async () => {
        delete source.afterRead;
        const second = row("second", "Appended during read", { parentUuid: "first" });
        await fs.appendFile(transcript, JSON.stringify(second) + "\n");
      };
      expect((await read()).messages.map((message) => message.uuid)).toEqual(["first"]);
      const prefixReads = source.bytesRead;
      expect((await read()).messages.map((message) => message.uuid)).toEqual(["first", "second"]);
      expect(source.bytesRead).toBeGreaterThan(prefixReads);
      const completeReads = source.bytesRead;
      await read();
      expect(source.bytesRead).toBe(completeReads);
    });
  });
});
