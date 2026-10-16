import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LoadAgentSessionHistoryInput } from "@openducktor/core";
import { AgentRuntimeQueryError } from "@openducktor/core";
import {
  loadClaudeHistory,
  type ClaudeLiveHistoryContext,
} from "./claude-agent-sdk-history-loader";

// A child process keeps the SDK config and transcript fixtures out of other tests.
const config = process.env.CLAUDE_CONFIG_DIR!;
const project = join(config, "projects", "history-startup-fixture");
process.env.CLAUDE_CODE_PROJECT_DIR_NAME = "history-startup-fixture";
await mkdir(project, { recursive: true });
const cwd = await realpath(config);
const sessionId = "00000000-0000-4000-8000-000000000001";
const timestamp = "2026-10-16T20:00:00.000Z";
const text = "Inspect the repository.";
const input: LoadAgentSessionHistoryInput = {
  repoPath: cwd,
  workingDirectory: cwd,
  runtimeKind: "claude",
  runtimePolicy: { kind: "claude" },
  externalSessionId: sessionId,
};
const live: ClaudeLiveHistoryContext = {
  activeBackgroundTaskIds: () => new Set(),
  hasActiveWork: () => true,
  source: "fresh",
  userMessages: [{ messageId: "user-1", timestamp, text }],
};
const writeTranscript = (entries: unknown[]) =>
  writeFile(
    join(project, `${sessionId}.jsonl`),
    `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
  );
const readHistory = async (context?: ClaudeLiveHistoryContext) => {
  try {
    return { history: await loadClaudeHistory(input, () => timestamp, context) };
  } catch (cause) {
    if (!(cause instanceof AgentRuntimeQueryError)) throw cause;
    return { code: cause.code, message: cause.message };
  }
};

// Claude writes these bookkeeping records before the first conversation entry with cwd.
const prefix = [
  { type: "custom-title", customTitle: "Startup fixture", sessionId },
  { type: "queue-operation", operation: "dequeue", timestamp, sessionId },
];
await writeTranscript(prefix);
const starting = await readHistory(live);
const stopped = await readHistory({ ...live, hasActiveWork: () => false });
const resumed = await readHistory({ ...live, source: "persisted" });
const detached = await readHistory();

const user = {
  type: "user",
  uuid: "user-1",
  parentUuid: null,
  sessionId,
  timestamp,
  cwd,
  message: { role: "user", content: text },
};
await writeTranscript([...prefix, user]);
const persisted = await readHistory(live);
await writeTranscript([...prefix, { ...user, cwd: join(cwd, "another-repository") }]);
const mismatch = await readHistory(live);

await Bun.write(
  Bun.stdout,
  JSON.stringify({ starting, stopped, resumed, detached, persisted, mismatch }),
);
