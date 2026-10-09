import { expect, mock, test } from "bun:test";
import { homedir } from "node:os";
import type {
  SDKControlInitializeResponse,
  SDKMessage,
  SDKSystemMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  loadClaudeToolCatalog,
  type ClaudeToolCatalogQueryFactory,
} from "./claude-agent-sdk-tool-catalog";

test("reads native init names through a local command without a model prompt or persisted session", async () => {
  const close = mock(() => {});
  let messages: AsyncIterator<SDKUserMessage> | undefined;
  const createQuery: ClaudeToolCatalogQueryFactory = ({ options, prompt }) => {
    expect(options.cwd).toBe(homedir());
    expect(options.persistSession).toBe(false);
    expect(options.pathToClaudeCodeExecutable).toBe("/selected/claude");
    expect(options.env?.CATALOG_TEST).toBe("selected-env");
    expect(options).not.toHaveProperty("resume");
    expect(options).not.toHaveProperty("mcpServers");
    expect(options).not.toHaveProperty("disallowedTools");
    const canUseTool = options.canUseTool;
    if (!canUseTool) throw new Error("Expected catalog approval handling");
    messages = prompt[Symbol.asyncIterator]();
    const stream = (async function* () {
      const command = await messages!.next();
      expect(command.value?.message.content).toBe("/context");
      expect(
        await canUseTool(
          "Write",
          {},
          {
            signal: new AbortController().signal,
            toolUseID: "catalog-tool",
            requestId: "catalog-request",
          },
        ),
      ).toMatchObject({ behavior: "deny" });
      yield initMessage([
        "Read",
        "Task",
        "Agent",
        "EndConversation",
        "CronList",
        "AskUserQuestion",
        "Read",
        "mcp__external__Read",
      ]);
    })();
    return Object.assign(stream, {
      close,
      initializationResult: async () => initialization(),
    });
  };
  const result = await loadClaudeToolCatalog({
    runtimeId: "runtime-1",
    claudeExecutablePath: "/selected/claude",
    processEnv: { CATALOG_TEST: "selected-env" },
    createQuery,
    signal: new AbortController().signal,
  });
  expect(result.tools).toEqual([
    { name: "Agent", canDisable: true },
    { name: "AskUserQuestion", canDisable: true },
    { name: "CronList", canDisable: true },
    {
      name: "EndConversation",
      canDisable: false,
      limitation: "Claude reserves EndConversation while other tools remain available.",
    },
    { name: "Read", canDisable: true },
  ]);
  expect((await messages!.next()).done).toBe(true);
  expect(close).toHaveBeenCalledTimes(1);
});

test.each(["missing-init", "invalid-name", "read-failure", "custom-command", "missing-command"])(
  "closes and exposes catalog %s failures",
  async (failure) => {
    const close = mock(() => {});
    let receivedPrompt = false;
    const createQuery: ClaudeToolCatalogQueryFactory = ({ prompt }) =>
      Object.assign(
        (async function* () {
          receivedPrompt = !(await prompt[Symbol.asyncIterator]().next()).done;
          if (failure === "read-failure") throw new Error("Native read failed. Retry the read.");
          if (failure !== "missing-init") yield initMessage(["Read(*)"]);
        })(),
        {
          close,
          initializationResult: async () =>
            failure === "missing-command"
              ? { ...initialization(), commands: [] }
              : initialization(failure !== "custom-command"),
        },
      );
    const result = await loadClaudeToolCatalog({
      runtimeId: "r",
      claudeExecutablePath: "/claude",
      createQuery,
      signal: new AbortController().signal,
    }).then(
      () => null,
      (error) => error,
    );
    expect(result).toBeInstanceOf(Error);
    expect(String(result)).toContain(
      failure === "read-failure" ? "Native read failed" : "Update Claude Code",
    );
    if (failure === "custom-command" || failure === "missing-command")
      expect(receivedPrompt).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
  },
);

test("cancellation closes a query that is still initializing", async () => {
  const gate = Promise.withResolvers<SDKControlInitializeResponse>();
  const controller = new AbortController();
  const close = mock(() => gate.reject(new Error("Query closed")));
  const result = loadClaudeToolCatalog({
    runtimeId: "r",
    claudeExecutablePath: "/claude",
    signal: controller.signal,
    createQuery: () =>
      Object.assign(
        (async function* () {
          yield initMessage(["Read"]);
        })(),
        {
          close,
          initializationResult: () => gate.promise,
        },
      ),
  }).then(
    () => null,
    (error) => error,
  );
  controller.abort();
  expect(await result).toBeInstanceOf(Error);
  expect(close).toHaveBeenCalledTimes(1);
});

test("cancellation closes a query waiting for native tool names", async () => {
  const started = Promise.withResolvers<void>();
  const next = Promise.withResolvers<IteratorResult<SDKMessage>>();
  const controller = new AbortController();
  const close = mock(() => next.reject(new Error("Query closed")));
  const result = loadClaudeToolCatalog({
    runtimeId: "r",
    claudeExecutablePath: "/claude",
    signal: controller.signal,
    createQuery: () => ({
      close,
      initializationResult: async () => initialization(),
      [Symbol.asyncIterator]: () => ({
        next: () => {
          started.resolve();
          return next.promise;
        },
      }),
    }),
  }).then(
    () => null,
    (error) => error,
  );
  await started.promise;
  controller.abort();
  expect(await result).toBeInstanceOf(Error);
  expect(close).toHaveBeenCalledTimes(1);
});

const initialization = (builtin = true): SDKControlInitializeResponse => ({
  commands: [
    { name: "context", description: "Show current context usage", argumentHint: "", builtin },
  ],
  models: [],
  agents: [],
  output_style: "default",
  available_output_styles: [],
  account: {},
});

const initMessage = (tools: string[]): SDKSystemMessage => ({
  type: "system",
  subtype: "init",
  uuid: "00000000-0000-0000-0000-000000000001",
  session_id: "catalog",
  apiKeySource: "none",
  claude_code_version: "2.1.296",
  cwd: homedir(),
  tools,
  mcp_servers: [],
  model: "native-default",
  permissionMode: "default",
  slash_commands: ["context"],
  output_style: "default",
  skills: [],
  plugins: [],
});
