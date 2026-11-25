import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFile, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mock, spyOn } from "bun:test";
import * as sdk from "@anthropic-ai/claude-agent-sdk";
import { Effect } from "effect";
import {
  addGitWorktree,
  gitFixtureEnv,
  initGitRepository,
} from "../../../test-support/git-repository-fixture";
import { createClaudeServiceFixture } from "../claude-agent-sdk-service.test-support";
import {
  createClaudeQueryFixture,
  createClaudeSession,
} from "../claude-agent-sdk-session-io.test-support";
import { createClaudeAgentSdkSessionStore } from "../claude-agent-sdk-session-store";

const config = process.env.CLAUDE_CONFIG_DIR;
assert.ok(config, "Pass a temporary Claude config directory.");
await mkdir(join(config, "repo"), { recursive: true });
const cwd = await realpath(join(config, "repo"));
const destination = join(config, "destination");
const foreign = join(config, "foreign");
const gitExecutable = Bun.which("git");
assert.ok(gitExecutable, "Install Git before running the Claude fork test.");
initGitRepository(cwd);
addGitWorktree(cwd, destination, "fork");
execFileSync(gitExecutable, ["init", "-q", foreign], {
  env: gitFixtureEnv,
  stdio: ["ignore", "pipe", "pipe"],
});
const project = join(config, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
await mkdir(project, { recursive: true });
const sourceId = randomUUID();
const firstUser = randomUUID();
const firstReply = randomUUID();
const secondUser = randomUUID();
const secondReply = randomUUID();
const firstTool = randomUUID();
const firstResult = randomUUID();
const secondTool = randomUUID();
const secondResult = randomUUID();
const timestamp = "2026-10-22T10:00:00.000Z";
const base = { cwd, sessionId: sourceId, timestamp, isSidechain: false };
const records = [
  {
    ...base,
    type: "user",
    uuid: firstUser,
    parentUuid: null,
    message: { role: "user", content: "First prompt" },
  },
  {
    ...base,
    type: "assistant",
    uuid: firstTool,
    parentUuid: firstUser,
    message: {
      id: "tool-first",
      role: "assistant",
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          id: "create-first",
          name: "TaskCreate",
          input: { subject: "First task" },
        },
      ],
    },
  },
  {
    ...base,
    type: "user",
    uuid: firstResult,
    parentUuid: firstTool,
    toolUseResult: { task: { id: "1", subject: "First task" } },
    message: {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "create-first", content: "Created first task" },
      ],
    },
  },
  {
    ...base,
    type: "assistant",
    uuid: firstReply,
    parentUuid: firstResult,
    message: {
      id: "response-first",
      role: "assistant",
      model: "old-model",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "First reply" }],
    },
  },
  {
    ...base,
    type: "user",
    uuid: secondUser,
    parentUuid: firstReply,
    message: { role: "user", content: "Second prompt" },
  },
  {
    ...base,
    type: "assistant",
    uuid: secondTool,
    parentUuid: secondUser,
    message: {
      id: "tool-second",
      role: "assistant",
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          id: "create-second",
          name: "TaskCreate",
          input: { subject: "Later task" },
        },
      ],
    },
  },
  {
    ...base,
    type: "user",
    uuid: secondResult,
    parentUuid: secondTool,
    toolUseResult: { task: { id: "2", subject: "Later task" } },
    message: {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "create-second", content: "Created later task" },
      ],
    },
  },
  {
    ...base,
    type: "assistant",
    uuid: secondReply,
    parentUuid: secondResult,
    message: {
      id: "response-second",
      role: "assistant",
      model: "old-model",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Second reply" }],
    },
  },
];
const transcriptPath = join(project, `${sourceId}.jsonl`);
const original = `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
await writeFile(transcriptPath, original);

const scope = {
  kind: "workflow" as const,
  workspaceId: "repo",
  taskId: "task-1",
  role: "build" as const,
};
const model = {
  runtimeKind: "claude" as const,
  providerId: "claude",
  modelId: "current-model",
  variant: "high",
};
const source = createClaudeSession({
  externalSessionId: sourceId,
  input: {
    repoPath: cwd,
    workingDirectory: cwd,
    externalSessionId: sourceId,
    runtimeKind: "claude",
    runtimePolicy: { kind: "claude" },
    sessionScope: scope,
  },
  runtimeId: "runtime-1",
  activity: "running",
  pendingUserTurnCount: 1,
  activeSdkUserTurnCount: 1,
  completedReplyChainIds: new Map([
    ["response-first", firstReply],
    ["synthetic-result", firstReply],
  ]),
  acceptedUserMessages: [
    { messageId: firstUser, text: "First prompt", parts: [], timestamp },
    { messageId: secondUser, text: "Second prompt", parts: [], timestamp },
  ],
});
const resolveSourceQuestion = mock(() => {});
source.pendingQuestions.set("question", {
  event: {
    type: "question_required",
    externalSessionId: sourceId,
    timestamp,
    requestId: "question",
    questions: [],
  },
  resolve: resolveSourceQuestion,
});
const launches: Parameters<typeof sdk.query>[0][] = [];
const query = spyOn(sdk, "query").mockImplementation((request) => {
  launches.push(request);
  const stream = Promise.withResolvers<void>();
  return createClaudeQueryFixture({
    close: () => stream.resolve(),
    async *[Symbol.asyncIterator]() {
      await stream.promise;
      yield* [];
    },
  });
});
const serviceOverrides: Parameters<typeof createClaudeServiceFixture>[3] = {
  processEnv: { ...process.env },
  toolDiscovery: {
    discoverTool: () => Effect.die("unused"),
    resolveTool: () => Effect.die("unused"),
    resolveToolPath: (toolId) =>
      Effect.succeed(toolId === "git" ? gitExecutable : process.execPath),
    validateToolPath: () =>
      Effect.succeed({
        displayLabel: "Saved path",
        path: process.execPath,
        sourceCategory: "provided_path",
      }),
  },
  launchPolicy: {
    resolve: () => Effect.succeed({ permissionMode: "dontAsk", toolAvailability: { Read: false } }),
  },
  resolveMcpBridgeConnection: () =>
    Effect.succeed({
      workspaceId: "workspace-1",
      hostUrl: "http://127.0.0.1:1",
      hostToken: "token",
    }),
};
const input = {
  repoPath: cwd,
  workingDirectory: destination,
  sourceWorkingDirectory: cwd,
  parentExternalSessionId: sourceId,
  runtimeKind: "claude" as const,
  runtimePolicy: { kind: "claude" as const },
  sessionScope: scope,
  systemPrompt: "Current workflow prompt",
  model,
  forkPoint: { messageId: "synthetic-result" },
};

const forkChild = async () => {
  const store = createClaudeAgentSdkSessionStore();
  const service = createClaudeServiceFixture(source, undefined, store, serviceOverrides);
  try {
    const summary = await Effect.runPromise(service.forkSession(input, "runtime-1"));
    const child = store.get(summary.externalSessionId);
    assert.ok(child);
    const childRef = {
      repoPath: cwd,
      runtimeKind: "claude" as const,
      runtimePolicy: { kind: "claude" as const },
      externalSessionId: child.externalSessionId,
      workingDirectory: destination,
      sessionScope: scope,
    };
    assert.notEqual(summary.externalSessionId, sourceId);
    assert.equal(summary.status, "idle");
    assert.equal(summary.workingDirectory, destination);
    assert.equal(child.activity, "idle");
    assert.equal(child.parentExternalSessionId, undefined);
    assert.equal(child.pendingUserTurnCount, 0);
    assert.equal(child.pendingQuestions.size, 0);
    assert.equal(child.pendingApprovals.size, 0);
    assert.equal(child.acceptedUserMessages.length, 0);
    assert.deepEqual(child.model, model);
    assert.deepEqual([...child.todosById.keys()], ["1"]);
    assert.equal(launches.length, 1);
    assert.equal(launches[0]?.options?.resume, child.externalSessionId);
    assert.equal(launches[0]?.options?.cwd, destination);
    assert.equal(launches[0]?.options?.forkSession, undefined);
    assert.equal(launches[0]?.options?.model, model.modelId);
    assert.equal(launches[0]?.options?.effort, "high");
    assert.equal(launches[0]?.options?.permissionMode, "dontAsk");
    assert.ok(launches[0]?.options?.disallowedTools?.includes("Read"));
    assert.equal(launches[0]?.prompt, child.queue);
    const childMessages = await sdk.getSessionMessages(child.externalSessionId, { dir: cwd });
    assert.deepEqual(
      childMessages.map((message) => message.message),
      records.slice(0, 4).map((record) => record.message),
    );
    assert.equal(await readFile(transcriptPath, "utf8"), original);
    assert.equal(store.get(sourceId), source);
    assert.equal(source.activity, "running");
    assert.equal(source.pendingQuestions.size, 1);
    assert.equal(resolveSourceQuestion.mock.calls.length, 0);
    assert.equal(source.pendingUserTurnCount, 1);

    await assert.rejects(
      Effect.runPromise(
        service.forkSession({ ...input, forkPoint: { messageId: "response-second" } }, "runtime-1"),
      ),
      /no completed persisted fork point/,
    );
    assert.equal(launches.length, 1);
    const refusal = spyOn(sdk, "forkSession").mockRejectedValue(new Error("Native fork refused"));
    try {
      await assert.rejects(
        Effect.runPromise(service.forkSession(input, "runtime-1")),
        /Native fork refused/,
      );
      assert.equal(refusal.mock.calls.length, 1);
      assert.equal(launches.length, 1);
    } finally {
      refusal.mockRestore();
    }

    await assert.rejects(
      Effect.runPromise(service.forkSession({ ...input, workingDirectory: foreign }, "runtime-1")),
      /belongs to another working directory/,
    );
    assert.equal(store.sessions.size, 2);
    assert.equal((await readdir(project)).filter((file) => file.endsWith(".jsonl")).length, 2);

    const snapshotStore = createClaudeAgentSdkSessionStore();
    const snapshotService = createClaudeServiceFixture(
      null,
      undefined,
      snapshotStore,
      serviceOverrides,
    );
    const getSessionInfo = sdk.getSessionInfo;
    let appended = false;
    let snapshotChildId: string | undefined;
    const changedSource = spyOn(sdk, "getSessionInfo").mockImplementation(async (...args) => {
      const metadata = await getSessionInfo(...args);
      if (args[0] === sourceId && !appended) {
        appended = true;
        await appendFile(
          transcriptPath,
          `${JSON.stringify({
            ...base,
            type: "assistant",
            uuid: randomUUID(),
            parentUuid: secondReply,
            message: {
              id: "response-first",
              role: "assistant",
              model: "old-model",
              stop_reason: "end_turn",
              content: [{ type: "text", text: "Later persisted reply" }],
            },
          })}\n`,
        );
      }
      return metadata;
    });
    try {
      const snapshotChild = await Effect.runPromise(
        snapshotService.forkSession(
          {
            ...input,
            sourceWorkingDirectory: destination,
            forkPoint: { messageId: "response-first" },
          },
          "snapshot-runtime",
        ),
      );
      snapshotChildId = snapshotChild.externalSessionId;
      assert.equal(appended, true);
      assert.deepEqual(
        (await sdk.getSessionMessages(snapshotChildId, { dir: destination })).map(
          (message) => message.message,
        ),
        records.slice(0, 4).map((record) => record.message),
      );
    } finally {
      changedSource.mockRestore();
      await Effect.runPromise(snapshotStore.stopSessionsForRuntime("snapshot-runtime"));
      await Effect.runPromise(snapshotService.dispose());
      if (snapshotChildId) await sdk.deleteSession(snapshotChildId, { dir: destination });
      await writeFile(transcriptPath, original);
    }

    query.mockImplementationOnce(() => {
      throw new Error("Child attach refused");
    });
    await assert.rejects(
      Effect.runPromise(service.forkSession(input, "runtime-1")),
      /Child attach refused/,
    );
    assert.equal((await readdir(project)).filter((file) => file.endsWith(".jsonl")).length, 2);
    assert.equal(await readFile(transcriptPath, "utf8"), original);
    return childRef;
  } finally {
    await Effect.runPromise(store.stopSessionsForRuntime("runtime-1"));
    await Effect.runPromise(service.dispose());
  }
};

const verifyPersistedHistory = async (childRef: Awaited<ReturnType<typeof forkChild>>) => {
  const restartedStore = createClaudeAgentSdkSessionStore();
  const restarted = createClaudeServiceFixture(null, undefined, restartedStore, serviceOverrides);
  try {
    const history = await Effect.runPromise(restarted.loadSessionHistory(childRef));
    const finalReply = history.at(-1);
    assert.ok(finalReply?.role === "assistant");
    assert.equal(finalReply.text, "First reply");
    assert.equal(finalReply.messageId, "response-first");
    assert.equal(finalReply.forkPoint?.messageId, "response-first");

    const subdirectory = join(destination, "subdirectory");
    await mkdir(subdirectory);
    for (const directory of [foreign, subdirectory]) {
      await assert.rejects(
        Effect.runPromise(
          restarted.loadSessionHistory({ ...childRef, workingDirectory: directory }),
        ),
        /belongs to another working directory/,
      );
    }
    await assert.rejects(
      Effect.runPromise(
        restarted.loadSessionHistory({ ...childRef, externalSessionId: randomUUID() }),
      ),
      /unavailable/,
    );
    const foreignId = randomUUID();
    const foreignProject = join(config, "projects", foreign.replace(/[^a-zA-Z0-9]/g, "-"));
    await mkdir(foreignProject, { recursive: true });
    await writeFile(
      join(foreignProject, `${foreignId}.jsonl`),
      `${records.map((record) => JSON.stringify({ ...record, sessionId: foreignId, cwd: foreign })).join("\n")}\n`,
    );
    await assert.rejects(
      Effect.runPromise(
        restarted.loadSessionHistory({ ...childRef, externalSessionId: foreignId }),
      ),
      /belongs to another working directory/,
    );
    const nativeMetadata = await sdk.getSessionInfo(childRef.externalSessionId, {
      dir: destination,
    });
    assert.ok(nativeMetadata);
    const wrongIdentity = spyOn(sdk, "getSessionInfo").mockResolvedValue({
      ...nativeMetadata,
      sessionId: randomUUID(),
    });
    try {
      await assert.rejects(
        Effect.runPromise(restarted.loadSessionHistory(childRef)),
        /belongs to another working directory/,
      );
    } finally {
      wrongIdentity.mockRestore();
    }
    const broadAccess = spyOn(sdk, "getSessionInfo").mockResolvedValue(nativeMetadata);
    try {
      await assert.rejects(
        Effect.runPromise(restarted.loadSessionHistory({ ...childRef, workingDirectory: foreign })),
        /belongs to another working directory/,
      );
    } finally {
      broadAccess.mockRestore();
    }
    const deniedAccess = spyOn(sdk, "getSessionInfo").mockRejectedValue(
      new Error("Public scope verification unavailable"),
    );
    try {
      await assert.rejects(
        Effect.runPromise(restarted.loadSessionHistory(childRef)),
        /Public scope verification unavailable/,
      );
      assert.equal(deniedAccess.mock.calls.length, 1);
    } finally {
      deniedAccess.mockRestore();
    }

    const reattached = await Effect.runPromise(
      restarted.resumeSession(
        { ...childRef, model, systemPrompt: input.systemPrompt },
        "restarted-runtime",
      ),
    );
    assert.equal(reattached.externalSessionId, childRef.externalSessionId);
    assert.equal(reattached.status, "idle");
    assert.deepEqual(await Effect.runPromise(restarted.loadSessionHistory(childRef)), history);

    execFileSync(gitExecutable, ["-C", cwd, "worktree", "remove", "--force", destination], {
      env: gitFixtureEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    await mkdir(destination, { recursive: true });
    await assert.rejects(
      Effect.runPromise(restarted.loadSessionHistory(childRef)),
      /belongs to another working directory/,
    );
  } finally {
    await Effect.runPromise(restartedStore.stopSessionsForRuntime("restarted-runtime"));
    await Effect.runPromise(restarted.dispose());
  }
};

try {
  const childRef = await forkChild();
  await verifyPersistedHistory(childRef);
} finally {
  query.mockRestore();
}
