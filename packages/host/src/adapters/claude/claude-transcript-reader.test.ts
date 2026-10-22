import { Effect } from "effect";
import { describe, expect, test } from "bun:test";
import { appendFile, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSessionHistoryMessage, LoadAgentSessionHistoryInput } from "@openducktor/core";
import { loadClaudeHistory } from "./claude-agent-sdk-history-loader";
import { loadClaudeSessionMessages } from "./claude-agent-sdk-history-messages";
import { loadClaudeTodos } from "./claude-agent-sdk-todos";
import { createClaudeTranscriptReadOwner } from "./claude-transcript-read-owner";
import { createClaudeTranscriptReader } from "./claude-transcript-reader";
import type { ClaudeProtocolObject, ClaudeProtocolValue } from "./claude-agent-sdk-ingress-schemas";
import { claudeSubagentExternalSessionId } from "./claude-agent-sdk-subagent-transcripts";

const sessionId = "00000000-0000-4000-8000-000000000001";
const timestamp = "2026-10-21T10:00:00.000Z";
type Storage = "memory" | "disk";
const storageModes: Storage[] = ["memory", "disk"];
type Entry = ClaudeProtocolObject;
type Fixture = {
  input: LoadAgentSessionHistoryInput;
  project: string;
  transcript: string;
  options: { processEnv: NodeJS.ProcessEnv; storage: Storage };
  user: (uuid: string, parentUuid: string | null, content: ClaudeProtocolValue) => Entry;
  assistant: (uuid: string, parentUuid: string, content: Entry[]) => Entry;
  write: (entries: Entry[]) => Promise<void>;
};

const withTranscript = async (run: (fixture: Fixture) => Promise<void>): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "claude-transcript-reader-"));
  try {
    const cwd = await realpath(root);
    const config = join(cwd, "config");
    const project = join(config, "projects", "arbitrary-project-name");
    await mkdir(project, { recursive: true });
    const transcript = join(project, `${sessionId}.jsonl`);
    const base = { sessionId, cwd, timestamp, parent_tool_use_id: null };
    await run({
      input: {
        repoPath: cwd,
        workingDirectory: cwd,
        externalSessionId: sessionId,
        runtimeKind: "claude",
        runtimePolicy: { kind: "claude" },
      },
      project,
      transcript,
      options: { processEnv: { CLAUDE_CONFIG_DIR: config }, storage: "memory" },
      user: (uuid, parentUuid, content) => ({
        type: "user",
        ...base,
        uuid,
        parentUuid,
        message: { role: "user", content },
      }),
      assistant: (uuid, parentUuid, content) => ({
        type: "assistant",
        ...base,
        uuid,
        parentUuid,
        message: {
          id: uuid,
          role: "assistant",
          content,
          stop_reason: content.some((block) => block.type === "tool_use") ? "tool_use" : "end_turn",
        },
      }),
      write: (entries) =>
        writeFile(transcript, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

const text = (value: string) => ({ type: "text", text: value });
const toolUse = (id: string, name: string, input: Entry) => ({ type: "tool_use", id, name, input });
const toolResult = (id: string, content: string) => ({
  type: "tool_result",
  tool_use_id: id,
  content,
});
const tools = (history: AgentSessionHistoryMessage[]) =>
  history.flatMap((message) => message.parts).filter((part) => part.kind === "tool");

describe("Claude transcript reader through saved history", () => {
  test.each(storageModes)(
    "keeps an undelivered queue hidden before SDK input that resembles command output with %s storage",
    async (storage) => {
      await withTranscript(async ({ user, write, input, options }) => {
        await write([
          user("request", null, "Original request"),
          {
            type: "attachment",
            uuid: "pending-queue",
            parentUuid: "request",
            sessionId,
            timestamp,
            attachment: { type: "queued_command", prompt: "Undelivered prompt" },
          },
          {
            ...user(
              "caveat",
              "pending-queue",
              "<local-command-caveat>Native caveat</local-command-caveat>",
            ),
            isMeta: true,
          },
          user("command", "caveat", "<command-name>/status</command-name>"),
          user("output", "command", "<local-command-stdout>Native output</local-command-stdout>"),
          {
            ...user(
              "human",
              "output",
              "<local-command-stdout>Explain this tag</local-command-stdout>",
            ),
            promptSource: "sdk",
          },
        ]);

        const messages = await Effect.runPromise(
          loadClaudeSessionMessages(input, { ...options, storage }),
        );
        expect(messages.map((message) => message.uuid)).toEqual([
          "request",
          "caveat",
          "command",
          "output",
          "human",
        ]);
      });
    },
  );

  test("hides transcript-only input without splitting the current assistant response", async () => {
    await withTranscript(async ({ user, assistant, write, input, options }) => {
      await write([
        user("user", null, "Inspect the repository"),
        {
          ...assistant("reply-start", "user", []),
          message: {
            id: "reply",
            role: "assistant",
            content: [text("Inspecting the repository")],
            stop_reason: null,
          },
        },
        {
          ...user("internal", "reply-start", "Internal continuation context"),
          isVisibleInTranscriptOnly: true,
          timestamp: "2026-10-21T10:00:02.000Z",
        },
        {
          ...assistant("reply-end", "internal", []),
          timestamp: "2026-10-21T10:00:03.000Z",
          message: {
            id: "reply",
            role: "assistant",
            content: [text("Inspection complete")],
            stop_reason: "end_turn",
          },
        },
      ]);

      const history = await Effect.runPromise(
        loadClaudeHistory(input, () => timestamp, undefined, options),
      );
      expect(history.map((message) => [message.messageId, message.role, message.text])).toEqual([
        ["user", "user", "Inspect the repository"],
        ["reply", "assistant", "Inspection complete"],
      ]);
      expect(history[0]?.timestamp).toBe(timestamp);
      expect(history[1]?.parts).toContainEqual(
        expect.objectContaining({ kind: "step", phase: "finish", reason: "stop" }),
      );
    });
  });

  test("restores pre-compaction turns and both parallel tool results in memory and on disk", async () => {
    await withTranscript(async ({ user, assistant, write, input, options }) => {
      await write([
        user("before-user", null, "Inspect before compaction"),
        assistant("before-answer", "before-user", [text("Starting before compaction")]),
        assistant("parallel-tools", "before-answer", [
          toolUse("read-call", "Read", { file_path: "src/app.ts" }),
          toolUse("bash-call", "Bash", { command: "bun test" }),
        ]),
        user("read-result", "parallel-tools", [toolResult("read-call", "source contents")]),
        user("bash-result", "parallel-tools", [toolResult("bash-call", "tests passed")]),
        assistant("before-final", "bash-result", [text("Finished before compaction")]),
        {
          type: "system",
          uuid: "compact-boundary",
          parentUuid: null,
          logicalParentUuid: "before-final",
          sessionId,
          cwd: input.workingDirectory,
          timestamp,
          subtype: "compact_boundary",
          compactMetadata: { trigger: "auto", preTokens: 90_000 },
        },
        user("after-user", "compact-boundary", "Continue after compaction"),
        assistant("after-answer", "after-user", [text("Finished after compaction")]),
      ]);
      const histories: AgentSessionHistoryMessage[][] = [];
      for (const storage of storageModes) {
        const history = await Effect.runPromise(
          loadClaudeHistory(input, () => timestamp, undefined, {
            ...options,
            storage,
          }),
        );
        expect(
          history
            .filter((message) => message.role !== "system")
            .map((message) => [message.messageId, message.text]),
        ).toEqual([
          ["before-user", "Inspect before compaction"],
          ["before-answer", "Starting before compaction"],
          ["parallel-tools", ""],
          ["before-final", "Finished before compaction"],
          ["after-user", "Continue after compaction"],
          ["after-answer", "Finished after compaction"],
        ]);
        expect(tools(history)).toEqual([
          expect.objectContaining({
            callId: "read-call",
            tool: "Read",
            status: "completed",
            output: "source contents",
          }),
          expect.objectContaining({
            callId: "bash-call",
            tool: "Bash",
            status: "completed",
            output: "tests passed",
          }),
        ]);
        histories.push(history);
      }
      expect(histories[1]).toEqual(histories[0]);
    });
  });

  test.each(storageModes)(
    "restores structured file diffs, TODO state, and a nested child prompt with %s storage",
    async (storage) => {
      await withTranscript(async ({ user, assistant, write, input, project, options }) => {
        await write([
          user("root-user", null, "Update the files"),
          assistant("write-use", "root-user", [
            toolUse("write-call", "Write", {
              file_path: "src/new.ts",
              content: "const value = 1;\n",
            }),
          ]),
          {
            ...user("write-result", "write-use", [toolResult("write-call", "Created src/new.ts")]),
            toolUseResult: {
              type: "create",
              filePath: "src/new.ts",
              content: "const value = 1;\n",
              originalFile: null,
              structuredPatch: [],
              userModified: false,
            },
          },
          assistant("edit-use", "write-result", [
            toolUse("edit-call", "Edit", {
              file_path: "src/new.ts",
              old_string: "1",
              new_string: "2",
            }),
          ]),
          {
            ...user("edit-result", "edit-use", [toolResult("edit-call", "Updated src/new.ts")]),
            tool_use_result: {
              filePath: "src/new.ts",
              oldString: "1",
              newString: "2",
              originalFile: "const value = 1;\n",
              structuredPatch: [
                {
                  oldStart: 1,
                  oldLines: 1,
                  newStart: 1,
                  newLines: 1,
                  lines: ["-const value = 1;", "+const value = 2;"],
                },
              ],
            },
          },
          assistant("todo-use", "edit-result", [
            toolUse("todo-call", "TaskCreate", { subject: "Verify the file" }),
          ]),
          {
            ...user("todo-result", "todo-use", [toolResult("todo-call", "Task created")]),
            toolUseResult: { task: { id: "1", subject: "Verify the file" } },
          },
          assistant("root-final", "todo-result", [text("Files updated")]),
        ]);
        const source = createClaudeTranscriptReader({ ...options, storage });
        let sourceReads = 0;
        const reader = createClaudeTranscriptReadOwner({
          read: (request) => {
            sourceReads += 1;
            return source.read(request);
          },
        });
        const [history, todos] = await Promise.all([
          Effect.runPromise(loadClaudeHistory(input, () => timestamp, undefined, { reader })),
          Effect.runPromise(loadClaudeTodos(input, { reader })),
        ]);
        await Effect.runPromise(reader.dispose());
        expect(sourceReads).toBe(1);
        expect(todos).toEqual([
          { id: "1", content: "Verify the file", status: "pending", priority: "medium" },
        ]);
        expect(tools(history)).toEqual([
          expect.objectContaining({
            callId: "write-call",
            status: "completed",
            fileDiffs: [
              expect.objectContaining({
                file: "src/new.ts",
                type: "added",
                additions: 1,
                deletions: 0,
                diff: expect.stringContaining("+const value = 1;"),
              }),
            ],
          }),
          expect.objectContaining({
            callId: "edit-call",
            status: "completed",
            fileDiffs: [
              expect.objectContaining({
                file: "src/new.ts",
                additions: 1,
                deletions: 1,
                diff: expect.stringContaining("+const value = 2;"),
              }),
            ],
          }),
          expect.objectContaining({
            callId: "todo-call",
            toolType: "todo",
            status: "completed",
            input: { todos: [{ step: "Verify the file", status: "pending" }] },
            output: "Plan updated",
          }),
        ]);
        const subagents = join(project, sessionId, "subagents", "nested");
        await mkdir(subagents, { recursive: true });
        await writeFile(
          join(subagents, "agent-child.jsonl"),
          [
            { ...user("child-prompt", null, "Verify the file in the child"), isSidechain: true },
            {
              ...assistant("child-answer", "child-prompt", [text("Child verification complete")]),
              isSidechain: true,
            },
          ]
            .map((entry) => JSON.stringify(entry))
            .join("\n") + "\n",
        );
        const child = await Effect.runPromise(
          loadClaudeHistory(
            { ...input, externalSessionId: claudeSubagentExternalSessionId(sessionId, "child") },
            () => timestamp,
            undefined,
            { ...options, storage },
          ),
        );
        expect(child.map((message) => [message.messageId, message.role, message.text])).toEqual([
          ["child-prompt", "user", "Verify the file in the child"],
          ["child-answer", "assistant", "Child verification complete"],
        ]);
      });
    },
  );

  test.each(storageModes)(
    "limits tool output while preserving its correlation IDs with %s storage",
    async (storage) => {
      await withTranscript(async ({ user, assistant, write, input, options }) => {
        await write([
          user("user", null, "Read the large output"),
          assistant("call", "user", [toolUse("large-call", "Bash", { command: "cat large.log" })]),
          user("result", "call", [toolResult("large-call", "x".repeat(128 * 1024))]),
          assistant("final", "result", [text("Read complete")]),
        ]);
        const history = await Effect.runPromise(
          loadClaudeHistory(input, () => timestamp, undefined, {
            ...options,
            storage,
          }),
        );
        const [tool] = tools(history);
        expect(tool).toMatchObject({
          messageId: "call",
          partId: "large-call",
          callId: "large-call",
          status: "completed",
        });
        expect(Buffer.byteLength(tool?.output ?? "")).toBeLessThanOrEqual(64 * 1024);
        expect(tool?.output).toMatch(/truncat/iu);
        expect(history.at(-1)?.text).toBe("Read complete");
      });
    },
  );

  test.each(storageModes)(
    "replays a large middle record at its UTF-8 byte offset with %s storage",
    async (storage) => {
      await withTranscript(async ({ user, assistant, write, input, options }) => {
        const content = "é 🦆\n".repeat(25_000);
        await write([
          user("before", null, "Avant 🦆"),
          assistant("write-call", "before", [
            text("Écrire la note"),
            toolUse("write-note", "Write", { file_path: "src/note.txt", content }),
          ]),
          {
            ...user("write-result", "write-call", [toolResult("write-note", "Note créée 🦆")]),
            fileHistorySnapshots: "x".repeat(3 * 1024 * 1024),
            toolUseResult: {
              structuredContent: { content, filePath: "src/note.txt", type: "create" },
            },
          },
          assistant("after", "write-result", [text("Terminé 🦆\nMerci")]),
        ]);

        const messages = await Effect.runPromise(
          loadClaudeSessionMessages(input, { ...options, storage }),
        );
        expect(messages.map((message) => message.uuid)).toEqual([
          "before",
          "write-call",
          "write-result",
          "after",
        ]);
        const before = messages[0];
        const after = messages[3];
        if (before?.type !== "user" || after?.type !== "assistant")
          throw new Error("Expected the user before replay and the assistant after replay.");
        expect(before.message).toEqual({ role: "user", content: "Avant 🦆" });
        expect(messages[2]?.toolUseResult).toEqual({
          structuredContent: { content, filePath: "src/note.txt", type: "create" },
        });
        expect(messages[2]).not.toHaveProperty("fileHistorySnapshots");
        expect(after.message).toEqual({
          id: "after",
          role: "assistant",
          content: [text("Terminé 🦆\nMerci")],
          stop_reason: "end_turn",
        });
      });
    },
  );

  test.each(storageModes)(
    "rejects a malformed complete line with its path and line number using %s storage",
    async (storage) => {
      await withTranscript(async ({ user, write, transcript, input, options }) => {
        await write([user("user", null, "Keep this valid turn")]);
        await appendFile(transcript, '{"type":"assistant",broken}\n');
        await expect(
          Effect.runPromise(loadClaudeSessionMessages(input, { ...options, storage })),
        ).rejects.toMatchObject({
          message: expect.stringContaining(`${transcript}:2`),
        });
      });
    },
  );

  test.each(storageModes)(
    "ignores an incomplete trailing line until it is complete with %s storage",
    async (storage) => {
      await withTranscript(async ({ user, assistant, write, transcript, input, options }) => {
        await write([user("user", null, "Read the live transcript")]);
        const pending = JSON.stringify(assistant("answer", "user", [text("Completed append")]));
        const split = pending.length - 12;
        await appendFile(transcript, pending.slice(0, split));
        const reader = createClaudeTranscriptReadOwner(
          createClaudeTranscriptReader({ ...options, storage }),
        );
        const before = await Effect.runPromise(
          loadClaudeHistory(input, () => timestamp, undefined, { reader }),
        );
        expect(before.map((message) => message.messageId)).toEqual(["user"]);
        await appendFile(transcript, `${pending.slice(split)}\n`);
        const after = await Effect.runPromise(
          loadClaudeHistory(input, () => timestamp, undefined, { reader }),
        );
        await Effect.runPromise(reader.dispose());
        expect(after.map((message) => [message.messageId, message.text])).toEqual([
          ["user", "Read the live transcript"],
          ["answer", "Completed append"],
        ]);
      });
    },
  );

  test.each(storageModes)(
    "uses the latest duplicate UUID contents in native order with %s storage",
    async (storage) => {
      await withTranscript(async ({ user, write, input, options }) => {
        await write([
          user("duplicate", null, "Original turn"),
          user("duplicate", null, "Conflicting turn"),
        ]);
        const history = await Effect.runPromise(
          loadClaudeHistory(input, () => timestamp, undefined, {
            ...options,
            storage,
          }),
        );
        expect(history.map((message) => [message.messageId, message.text])).toEqual([
          ["duplicate", "Conflicting turn"],
        ]);
      });
    },
  );

  test("rejects ambiguous root transcripts instead of choosing one project", async () => {
    await withTranscript(async ({ user, write, input, options, project }) => {
      const row = user("user", null, "Ambiguous session");
      await write([row]);
      const otherProject = join(project, "..", "other-project");
      await mkdir(otherProject, { recursive: true });
      await writeFile(join(otherProject, `${sessionId}.jsonl`), `${JSON.stringify(row)}\n`);
      await expect(
        Effect.runPromise(loadClaudeSessionMessages(input, options)),
      ).rejects.toMatchObject({
        message: expect.stringMatching(/multiple|ambiguous/iu),
      });
    });
  });

  test("rejects a transcript that belongs to another working directory", async () => {
    await withTranscript(async ({ user, write, input, options }) => {
      await write([
        { ...user("user", null, "Other project"), cwd: join(input.workingDirectory, "other") },
      ]);
      await expect(
        Effect.runPromise(loadClaudeSessionMessages(input, options)),
      ).rejects.toMatchObject({
        code: "scope_mismatch",
      });
    });
  });

  test.each(storageModes)(
    "rejects a selected child from another native session with %s storage",
    async (storage) => {
      await withTranscript(async ({ user, write, input, project, options }) => {
        await write([user("root-user", null, "Read this session")]);
        const children = join(project, sessionId, "subagents");
        await mkdir(children, { recursive: true });
        await writeFile(
          join(children, "agent-child.jsonl"),
          JSON.stringify({
            ...user("foreign-user", null, "This child belongs to another session"),
            sessionId: "00000000-0000-4000-8000-000000000002",
            isSidechain: true,
          }) + "\n",
        );
        await expect(
          Effect.runPromise(
            loadClaudeHistory(
              { ...input, externalSessionId: claudeSubagentExternalSessionId(sessionId, "child") },
              () => timestamp,
              undefined,
              { ...options, storage },
            ),
          ),
        ).rejects.toMatchObject({ code: "scope_mismatch" });
      });
    },
  );

  test("rejects a symbolic link at the top-level subagents directory", async () => {
    await withTranscript(async ({ user, write, input, project, options }) => {
      await write([user("root-user", null, "Read this session")]);
      const childDirectory = join(input.workingDirectory, "external-subagents");
      await mkdir(childDirectory);
      await writeFile(
        join(childDirectory, "agent-child.jsonl"),
        JSON.stringify({
          ...user("linked-user", null, "This child is outside its native directory"),
          isSidechain: true,
        }) + "\n",
      );
      await mkdir(join(project, sessionId));
      await symlink(
        childDirectory,
        join(project, sessionId, "subagents"),
        process.platform === "win32" ? "junction" : "dir",
      );
      await expect(
        Effect.runPromise(
          loadClaudeHistory(
            { ...input, externalSessionId: claudeSubagentExternalSessionId(sessionId, "child") },
            () => timestamp,
            undefined,
            options,
          ),
        ),
      ).rejects.toMatchObject({ message: expect.stringContaining("symbolic link") });
    });
  });

  test.each(storageModes)(
    "uses the latest native relocation directory with %s storage",
    async (storage) => {
      await withTranscript(async ({ user, write, input, options }) => {
        const movedDirectory = join(input.workingDirectory, "moved-repository");
        await mkdir(movedDirectory);
        await write([
          user("user", null, "Keep the history after moving the repository"),
          { type: "relocated", sessionId, relocatedCwd: movedDirectory },
        ]);
        const history = await Effect.runPromise(
          loadClaudeHistory(
            { ...input, workingDirectory: movedDirectory },
            () => timestamp,
            undefined,
            { ...options, storage },
          ),
        );
        expect(history.map((message) => [message.messageId, message.text])).toEqual([
          ["user", "Keep the history after moving the repository"],
        ]);
        await expect(
          Effect.runPromise(
            loadClaudeHistory(input, () => timestamp, undefined, { ...options, storage }),
          ),
        ).rejects.toMatchObject({ code: "scope_mismatch" });
      });
    },
  );

  test.each(storageModes)(
    "closes native files and removes temporary records after cancellation with %s storage",
    async (storage) => {
      await withTranscript(async ({ user, write, input, options, transcript }) => {
        await write([user("user", null, "A".repeat(256 * 1024))]);
        const temporaryDirectory = join(input.workingDirectory, "cancelled-reader-temporary-files");
        await mkdir(temporaryDirectory);
        // A child process isolates native file observers from parallel host tests.
        const worker = Bun.spawn(
          [
            process.execPath,
            "--eval",
            String.raw`
        import fs from "node:fs/promises";
        import { mock } from "bun:test";
        import { Effect } from "effect";
        const input = JSON.parse(process.env.ODT_READER_TEST_INPUT);
        const sourcePath = process.env.ODT_READER_TEST_TRANSCRIPT;
        const controller = new AbortController();
        const observations = { opened: [], closed: [], sourceReads: 0, error: "" };
        const originalOpen = fs.open;
        fs.open = async (...args) => {
          const path = String(args[0]);
          const file = await originalOpen(...args);
          observations.opened.push(path);
          const originalClose = file.close.bind(file);
          file.close = async (...closeArgs) => {
            const result = await originalClose(...closeArgs);
            observations.closed.push(path);
            return result;
          };
          if (path === sourcePath) {
            const originalRead = file.read.bind(file);
            file.read = async (...readArgs) => {
              const result = await originalRead(...readArgs);
              observations.sourceReads++;
              if (observations.sourceReads === 1) controller.abort();
              return result;
            };
          }
          return file;
        };
        mock.module("node:fs/promises", () => ({ ...fs }));
        const { loadClaudeHistory } = await import(process.env.ODT_READER_TEST_MODULE);
        try {
          await Effect.runPromise(loadClaudeHistory(input, () => "2026-10-21T10:00:00.000Z", undefined, {
            processEnv: { CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR },
            storage: process.env.ODT_READER_TEST_STORAGE,
          }), { signal: controller.signal });
        } catch (error) {
          observations.error = error.message;
        }
        console.log(JSON.stringify({ ...observations, tempEntries: await fs.readdir(process.env.TMPDIR) }));
      `,
          ],
          {
            env: {
              ...process.env,
              CLAUDE_CONFIG_DIR: options.processEnv.CLAUDE_CONFIG_DIR,
              TMPDIR: temporaryDirectory,
              TMP: temporaryDirectory,
              TEMP: temporaryDirectory,
              ODT_READER_TEST_INPUT: JSON.stringify(input),
              ODT_READER_TEST_TRANSCRIPT: transcript,
              ODT_READER_TEST_MODULE: new URL(
                "./claude-agent-sdk-history-loader.ts",
                import.meta.url,
              ).href,
              ODT_READER_TEST_STORAGE: storage,
            },
            cwd: import.meta.dir,
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
          expect({ code, error }).toEqual({ code: 0, error: "" });
          // SAFETY: The isolated worker emits only the native file observations shown above.
          const result = JSON.parse(output) as {
            opened: string[];
            closed: string[];
            sourceReads: number;
            error: string;
            tempEntries: string[];
          };
          expect(result.error).toMatch(/interrupt/iu);
          expect(result.sourceReads).toBe(1);
          expect(result.opened).toContain(transcript);
          expect(result.closed.sort()).toEqual(result.opened.sort());
          expect(result.tempEntries).toEqual([]);
          expect(result.opened.some((path) => path.startsWith(temporaryDirectory))).toBe(
            storage === "disk",
          );
        } finally {
          worker.kill();
          await worker.exited;
        }
      });
    },
  );
});
