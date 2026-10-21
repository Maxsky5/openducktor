import fs from "node:fs";
import fsPromises from "node:fs/promises";
import { mock } from "bun:test";
import { join } from "node:path";
import type {
  AgentSessionHistoryMessage,
  AgentSessionTodoItem,
  LoadAgentSessionHistoryInput,
} from "@openducktor/core";

// Run in a child process so instrumentation and the SDK config cannot affect other tests.
const config = process.env.CLAUDE_CONFIG_DIR!;
await fsPromises.mkdir(join(config, "repo"), { recursive: true });
const cwd = await fsPromises.realpath(join(config, "repo"));
const sessionId = "00000000-0000-4000-8000-000000000001";
// Use the SDK's project-directory setting instead of duplicating its path shortening and hashing.
process.env.CLAUDE_CODE_PROJECT_DIR_NAME = "history-read-fixture";
const project = join(config, "projects", process.env.CLAUDE_CODE_PROJECT_DIR_NAME);
await fsPromises.mkdir(join(project, sessionId, "subagents"), { recursive: true });
await fsPromises.mkdir(join(project, sessionId, "subagents", "team"), { recursive: true });
const timestamp = "2026-10-11T10:00:00.000Z";
const user = {
  type: "user",
  uuid: "user-1",
  parentUuid: null,
  sessionId,
  cwd,
  timestamp,
  message: { role: "user", content: "Inspect the repository" },
};
const assistant = (
  uuid: string,
  parentUuid: string,
  content: unknown[],
  stopReason: string | null,
  parentToolUseId: string | null = null,
) => ({
  type: "assistant",
  uuid,
  parentUuid,
  sessionId,
  cwd,
  timestamp,
  parent_tool_use_id: parentToolUseId,
  message: { id: uuid, role: "assistant", content, stop_reason: stopReason },
});
const root = [
  user,
  assistant(
    "task-call",
    user.uuid,
    [
      {
        type: "tool_use",
        id: "create-task",
        name: "TaskCreate",
        input: { subject: "Inspect stored task" },
      },
    ],
    "tool_use",
  ),
  {
    ...user,
    uuid: "task-result",
    parentUuid: "task-call",
    toolUseResult: { task: { id: "1", subject: "Inspect stored task" } },
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "create-task",
          content: "Task #1 created successfully: Inspect stored task",
        },
      ],
    },
  },
];
const entries: unknown[] = [...root];
let parent = "task-result";
for (let index = 0; index < 701; index++) {
  const uuid = `assistant-${index}`;
  entries.push(
    assistant(
      uuid,
      parent,
      [{ type: "text", text: `Message ${index} ${"x".repeat(256)}` }],
      "end_turn",
    ),
  );
  parent = uuid;
}
entries.push(
  assistant(
    "agent-call",
    parent,
    [
      {
        type: "tool_use",
        id: "child-tool",
        name: "Agent",
        input: { description: "Inspect child", subagent_type: "Explore", prompt: "Inspect child" },
      },
    ],
    "tool_use",
  ),
);
const child = [
  { ...user, uuid: "child-user", isSidechain: true, parent_tool_use_id: "child-tool" },
  {
    ...user,
    uuid: "child-instructions",
    parentUuid: "child-user",
    isSidechain: true,
    isMeta: true,
    message: { role: "user", content: "Internal child instructions" },
  },
  {
    ...assistant(
      "child-call",
      "child-instructions",
      [
        {
          type: "tool_use",
          id: "grandchild-tool",
          name: "Agent",
          input: {
            description: "Inspect nested child",
            prompt: "Inspect nested child",
            run_in_background: process.env.CLAUDE_HISTORY_EXECUTION_MODE === "background",
          },
        },
      ],
      "tool_use",
      "child-tool",
    ),
    isSidechain: true,
  },
  {
    ...user,
    uuid: "grandchild-launch",
    parentUuid: "child-call",
    isSidechain: true,
    parent_tool_use_id: "child-tool",
    toolUseResult: { agentId: "grandchild", status: "running" },
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "grandchild-tool", content: "Child launched" }],
    },
  },
  {
    ...assistant(
      "child-final",
      "grandchild-launch",
      [{ type: "text", text: "Child done" }],
      "end_turn",
      "child-tool",
    ),
    isSidechain: true,
  },
];
const grandchild = [
  { ...user, uuid: "grandchild-user", isSidechain: true, parent_tool_use_id: "grandchild-tool" },
  {
    ...assistant(
      "grandchild-final",
      "grandchild-user",
      [{ type: "text", text: "Nested child done" }],
      "end_turn",
      "grandchild-tool",
    ),
    isSidechain: true,
  },
];
const writeTranscript = (path: string, rows: unknown[]) =>
  fsPromises.writeFile(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
await writeTranscript(join(project, `${sessionId}.jsonl`), entries);
await writeTranscript(join(project, sessionId, "subagents", "agent-child.jsonl"), child);
await fsPromises.writeFile(
  join(project, sessionId, "subagents", "agent-child.meta.json"),
  JSON.stringify({ toolUseId: "child-tool", agentType: "Explore" }),
);
await writeTranscript(
  join(project, sessionId, "subagents", "team", "agent-grandchild.jsonl"),
  grandchild,
);

let reads = new Map<string, number>();
let diskBytes = 0;
let serializedBytes = 0;
const originalStringify = JSON.stringify;
// SAFETY: The wrapper forwards all arguments and preserves both JSON.stringify overloads.
JSON.stringify = ((...args: Parameters<typeof JSON.stringify>) => {
  const result = originalStringify(...args);
  if (result !== undefined) serializedBytes += Buffer.byteLength(result);
  return result;
}) as typeof JSON.stringify;
const record = (path: string): void => {
  if (path.endsWith(".jsonl")) reads.set(path, (reads.get(path) ?? 0) + 1);
};
const originalStream = fs.createReadStream;
const originalReadFile = fsPromises.readFile;
const originalOpen = fsPromises.open;
fs.createReadStream = (path, options) => {
  const filename = String(path);
  record(filename);
  const stream = originalStream(path, options);
  if (filename.endsWith(".jsonl"))
    stream.on("data", (chunk) => {
      diskBytes += Buffer.byteLength(chunk);
    });
  return stream;
};
// SAFETY: The wrapper forwards the original arguments and result. The assertion preserves the overloads for each encoding.
fsPromises.readFile = (async (...args: Parameters<typeof fsPromises.readFile>) => {
  const filename = String(args[0]);
  record(filename);
  const result = await originalReadFile(...args);
  if (filename.endsWith(".jsonl")) diskBytes += Buffer.byteLength(result);
  return result;
}) as typeof fsPromises.readFile;
fsPromises.open = async (...args) => {
  record(String(args[0]));
  return originalOpen(...args);
};
// Bun's native builtin bindings do not update through syncBuiltinESMExports.
// Replace only this child process's SDK import specifiers with measured passthroughs.
mock.module("fs", () => ({ ...fs }));
mock.module("fs/promises", () => ({ ...fsPromises }));

const { loadClaudeHistory } = await import("./claude-agent-sdk-history-loader");
const { loadClaudeTodos } = await import("./claude-agent-sdk-todos");
const { claudeSubagentExternalSessionId } = await import("./claude-agent-sdk-subagent-transcripts");
const input: LoadAgentSessionHistoryInput = {
  repoPath: cwd,
  workingDirectory: cwd,
  runtimeKind: "claude",
  externalSessionId: sessionId,
  runtimePolicy: { kind: "claude" },
};
const measure = async (
  view: string,
  run: () => Promise<AgentSessionHistoryMessage[] | AgentSessionTodoItem[]>,
) => {
  reads = new Map();
  diskBytes = 0;
  serializedBytes = 0;
  const started = performance.now();
  const result = await run();
  return {
    view,
    reads: Object.fromEntries(
      [...reads].map(([path, count]) => [
        path.slice(project.length + 1).replaceAll("\\", "/"),
        count,
      ]),
    ),
    diskBytes,
    serializedBytes,
    responseBytes: Buffer.byteLength(JSON.stringify(result)),
    elapsedMs: performance.now() - started,
    result,
  };
};
const rootResult = await measure("root transcript", () =>
  loadClaudeHistory(input, () => timestamp),
);
const childResult = await measure("child transcript", () =>
  loadClaudeHistory(
    { ...input, externalSessionId: claudeSubagentExternalSessionId(sessionId, "child") },
    () => timestamp,
  ),
);
const todoResult = await measure("root todos", () => loadClaudeTodos(input));
const nestedResult = await measure("nested child transcript", () =>
  loadClaudeHistory(
    {
      ...input,
      externalSessionId: claudeSubagentExternalSessionId(
        claudeSubagentExternalSessionId(sessionId, "child"),
        "grandchild",
      ),
    },
    () => timestamp,
  ),
);
await Bun.write(
  Bun.stdout,
  `${JSON.stringify([rootResult, childResult, todoResult, nestedResult])}\n`,
);
