import { expect, test } from "bun:test";
import { agentJsonOutputSchema } from "@openducktor/contracts";
import { z } from "zod";
import type { CodexAppServerConfigReadResponse } from "@openducktor/contracts";
import type { CodexConfiguredMcpServers } from "./codex-app-server-adapter.test-harness";

type RecordingTransportLayers = NonNullable<CodexAppServerConfigReadResponse["layers"]>;
import {
  codexTurnFixture,
  createHarness,
  createRuntimeStreamSubscription,
  flushCodexAdapterWork,
} from "./codex-app-server-adapter.test-harness";

const THREAD_ID = "thread/start-runtime-live";
const input = {
  repoPath: "/repo",
  model: { runtimeKind: "codex", providerId: "openai", modelId: "gpt-5", variant: "medium" },
  instructions: "Write one goal.",
  prompt: "Task: Add goals.",
} as const;

const answerSchema = z.strictObject({ title: z.string() });

const startGeneration = async (
  configuredMcpServers: CodexConfiguredMcpServers = {},
  configLayers: RecordingTransportLayers = [],
  answer: "text" | "json" = "text",
) => {
  const stream = createRuntimeStreamSubscription();
  const harness = createHarness({ subscribeEvents: stream.subscribeEvents });
  harness.transportFactory("runtime-live").configuredMcpServers = configuredMcpServers;
  harness.transportFactory("runtime-live").configLayers = configLayers;
  const signal = new AbortController().signal;
  const generation: Promise<unknown> =
    answer === "json"
      ? harness.adapter.generateJson("runtime-live", { ...input, answerSchema }, signal)
      : harness.adapter.generateText("runtime-live", input, signal);
  const transport = () => harness.transports.get("runtime-live");
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (transport()?.calls.some(({ method }) => method === "turn/start")) break;
    await flushCodexAdapterWork();
  }
  const runtime = transport();
  if (!runtime) throw new Error("Expected the Codex transport.");
  return { stream, generation, calls: () => runtime.calls };
};

test("answers in an ephemeral read-only thread and unsubscribes it", async () => {
  const { stream, generation, calls } = await startGeneration();
  stream.emitNotification({
    method: "item/completed",
    params: {
      threadId: THREAD_ID,
      turnId: "turn-1",
      completedAtMs: 1_777_766_419_650,
      item: {
        type: "agentMessage",
        id: "message-1",
        text: "The goal.",
        phase: "final_answer",
        memoryCitation: null,
      },
    },
  });
  stream.emitNotification({
    method: "turn/completed",
    params: {
      threadId: THREAD_ID,
      turn: codexTurnFixture({ id: "turn-1", status: "completed", items: [] }),
    },
  });

  expect(await generation).toBe("The goal.");
  const requests = calls().filter(({ method }) =>
    ["thread/start", "turn/start", "thread/unsubscribe"].includes(method),
  );
  expect(requests.map(({ method }) => method)).toEqual([
    "thread/start",
    "turn/start",
    "thread/unsubscribe",
  ]);
  expect(calls().find(({ method }) => method === "config/read")?.params).toEqual({
    cwd: "/repo",
    includeLayers: true,
  });
  expect(requests[0]?.params).toMatchObject({
    cwd: "/repo",
    model: "gpt-5",
    ephemeral: true,
    approvalPolicy: "never",
    sandbox: "read-only",
    environments: [],
    developerInstructions: "Write one goal.",
  });
  expect(requests[1]?.params).toMatchObject({
    threadId: THREAD_ID,
    input: [{ type: "text", text: "Task: Add goals.", text_elements: [] }],
    model: "gpt-5",
    effort: "medium",
  });
});

test("turns off each configured MCP server, plugins, and apps in the thread", async () => {
  const { generation, calls } = await startGeneration({
    docs: { command: "docs-server" },
    "team.search": { url: "https://search.example" },
  });
  const start = calls().find(({ method }) => method === "thread/start");
  expect(start?.params).toMatchObject({
    config: {
      "features.hooks": false,
      "features.plugin_hooks": false,
      "features.plugins": false,
      "features.apps": false,
      "features.shell_tool": false,
      "features.unified_exec": false,
      "features.sleep_tool": false,
      notify: [],
      "agents.enabled": false,
      mcp_servers: { docs: { enabled: false }, "team.search": { enabled: false } },
    },
  });
  void generation.catch(() => undefined);
});

test.each([
  [
    "managed requirements pin the shell tool on",
    { featureRequirements: { shell_tool: true } },
    "turn on the feature shell_tool",
  ],
  [
    "managed requirements pin child agents on by their legacy name",
    { featureRequirements: { collab: true } },
    "turn on the feature collab",
  ],
  [
    "managed requirements pin the async message tool on",
    { featureRequirements: { send_message_to_user_async: true } },
    "turn on the feature send_message_to_user_async",
  ],
  [
    "a legacy managed layer keeps the sleep tool always on",
    {
      configLayers: [
        {
          name: { type: "legacyManagedConfigTomlFromFile" },
          config: { features: { sleep_tool: { enabled: true, mode: "always_on" } } },
        },
      ],
    },
    "sets features.sleep_tool",
  ],
  [
    "a legacy managed layer turns the plan tool on",
    {
      configLayers: [
        {
          name: { type: "legacyManagedConfigTomlFromFile" },
          config: { tools: { update_plan: { enabled: true } } },
        },
      ],
    },
    "sets tools.update_plan",
  ],
  [
    "managed requirements pin hooks on without allow_managed_hooks_only",
    { featureRequirements: { hooks: true } },
    "without allow_managed_hooks_only",
  ],
  [
    "a legacy managed layer turns hooks on without allow_managed_hooks_only",
    {
      configLayers: [
        {
          name: { type: "legacyManagedConfigTomlFromMdm" },
          config: { features: { codex_hooks: true } },
        },
      ],
    },
    "turn on the feature codex_hooks without allow_managed_hooks_only",
  ],
  [
    "a legacy managed layer turns hosted web search on",
    {
      configLayers: [
        { name: { type: "legacyManagedConfigTomlFromFile" }, config: { web_search: "live" } },
      ],
    },
    "sets web_search",
  ],
  [
    "a legacy managed layer turns child agents on",
    {
      configLayers: [
        { name: { type: "legacyManagedConfigTomlFromMdm" }, config: { agents: { enabled: true } } },
      ],
    },
    "sets agents.enabled",
  ],
] as const)("starts no thread when %s", async (_case, policy, message) => {
  const stream = createRuntimeStreamSubscription();
  const harness = createHarness({ subscribeEvents: stream.subscribeEvents });
  const transport = harness.transportFactory("runtime-live");
  Object.assign(transport, policy);
  await expect(
    harness.adapter.generateText("runtime-live", input, new AbortController().signal),
  ).rejects.toThrow(message);
  expect(transport.calls.some(({ method }) => method === "thread/start")).toBe(false);
});

test("accepts managed hooks and notify commands when only managed hooks may run", async () => {
  const stream = createRuntimeStreamSubscription();
  const harness = createHarness({ subscribeEvents: stream.subscribeEvents });
  const transport = harness.transportFactory("runtime-live");
  transport.featureRequirements = { hooks: true };
  transport.allowManagedHooksOnly = true;
  transport.configLayers = [
    {
      name: { type: "legacyManagedConfigTomlFromFile" },
      config: { features: { codex_hooks: true }, notify: ["audit"] },
    },
  ];
  const generation = harness.adapter.generateText(
    "runtime-live",
    input,
    new AbortController().signal,
  );
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (transport.calls.some(({ method }) => method === "thread/start")) break;
    await flushCodexAdapterWork();
  }
  const calls = () => transport.calls;
  expect(calls().some(({ method }) => method === "thread/start")).toBe(true);
  void generation.catch(() => undefined);
});

test("lets the thread overrides win over user and project layers", async () => {
  const { generation, calls } = await startGeneration({}, [
    { name: { type: "user" }, config: { features: { hooks: true }, notify: ["say"] } },
  ]);
  expect(calls().some(({ method }) => method === "thread/start")).toBe(true);
  void generation.catch(() => undefined);
});

test("starts no thread after the caller gives up during setup", async () => {
  const stream = createRuntimeStreamSubscription();
  const harness = createHarness({ subscribeEvents: stream.subscribeEvents });
  const transport = harness.transportFactory("runtime-live");
  const abort = new AbortController();
  transport.beforeConfigReadAnswer = async () => abort.abort(new Error("Naming timed out."));
  await expect(harness.adapter.generateText("runtime-live", input, abort.signal)).rejects.toThrow(
    "Naming timed out.",
  );
  const methods = transport.calls.map(({ method }) => method);
  expect(methods).toContain("config/read");
  expect(methods).not.toContain("thread/start");
  expect(methods).not.toContain("turn/start");
});

test("interrupts the turn and releases the thread when the caller gives up during the turn", async () => {
  const stream = createRuntimeStreamSubscription();
  const harness = createHarness({ subscribeEvents: stream.subscribeEvents });
  const transport = harness.transportFactory("runtime-live");
  const abort = new AbortController();
  const generation = harness.adapter.generateText("runtime-live", input, abort.signal);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (transport.calls.some(({ method }) => method === "turn/start")) break;
    await flushCodexAdapterWork();
  }
  abort.abort(new Error("Naming timed out."));

  await expect(generation).rejects.toThrow("Naming timed out.");
  const interrupt = transport.calls.find(({ method }) => method === "turn/interrupt");
  expect(interrupt?.params).toMatchObject({ threadId: THREAD_ID });
  expect(transport.calls.map(({ method }) => method)).toContain("thread/unsubscribe");
});

test("rejects an effort that the model does not offer before it starts a thread", async () => {
  const stream = createRuntimeStreamSubscription();
  const harness = createHarness({ subscribeEvents: stream.subscribeEvents });
  await expect(
    harness.adapter.generateText(
      "runtime-live",
      { ...input, model: { ...input.model, variant: "low" } },
      new AbortController().signal,
    ),
  ).rejects.toThrow("Codex model 'openai/gpt-5' does not support reasoning effort 'low'.");
  const calls = harness.transports.get("runtime-live")?.calls ?? [];
  expect(calls.some(({ method }) => method === "thread/start")).toBe(false);
});

test("reports a failed turn", async () => {
  const { stream, generation } = await startGeneration();
  stream.emitNotification({
    method: "turn/completed",
    params: {
      threadId: THREAD_ID,
      turn: codexTurnFixture({ id: "turn-1", status: "failed", items: [] }),
    },
  });
  await expect(generation).rejects.toThrow("Codex did not generate the text");
});

test("reports a runtime stop during the turn request, not the failed unsubscribe", async () => {
  const stream = createRuntimeStreamSubscription();
  const harness = createHarness({ subscribeEvents: stream.subscribeEvents });
  const transport = harness.transportFactory("runtime-live");
  transport.unsubscribeError = new Error("The Codex connection is closed.");
  transport.beforeTurnStartAnswer = async () => {
    harness.adapter.releaseRuntime("runtime-live");
    throw new Error("The Codex connection is closed.");
  };

  await expect(
    harness.adapter.generateText("runtime-live", input, new AbortController().signal),
  ).rejects.toThrow("The Codex runtime stopped before it generated the text.");
});

test("answers with the turn's own message, not an async message to the user", async () => {
  const { stream, generation } = await startGeneration();
  const message = (id: string, text: string, delivery: "async" | null) =>
    stream.emitNotification({
      method: "item/completed",
      params: {
        threadId: THREAD_ID,
        turnId: "turn-1",
        completedAtMs: 1_777_766_419_650,
        item: {
          type: "agentMessage",
          id,
          text,
          phase: "final_answer",
          memoryCitation: null,
          delivery,
        },
      },
    });
  message("message-1", "The goal.", null);
  message("message-2", "Working on it.", "async");
  stream.emitNotification({
    method: "turn/completed",
    params: {
      threadId: THREAD_ID,
      turn: codexTurnFixture({ id: "turn-1", status: "completed", items: [] }),
    },
  });

  expect(await generation).toBe("The goal.");
});

const finishTurn = (stream: ReturnType<typeof createRuntimeStreamSubscription>, text: string) => {
  stream.emitNotification({
    method: "item/completed",
    params: {
      threadId: THREAD_ID,
      turnId: "turn-1",
      completedAtMs: 1_777_766_419_650,
      item: {
        type: "agentMessage",
        id: "message-1",
        text,
        phase: "final_answer",
        memoryCitation: null,
      },
    },
  });
  stream.emitNotification({
    method: "turn/completed",
    params: {
      threadId: THREAD_ID,
      turn: codexTurnFixture({ id: "turn-1", status: "completed", items: [] }),
    },
  });
};

test("constrains a JSON answer to the output schema and reads its value", async () => {
  const { stream, generation, calls } = await startGeneration({}, [], "json");
  finishTurn(stream, '{"title":"Login fix"}');

  expect(await generation).toEqual({ title: "Login fix" });
  expect(calls().find(({ method }) => method === "turn/start")?.params).toMatchObject({
    outputSchema: agentJsonOutputSchema(answerSchema),
  });
});

test("sends no output schema for a text answer", async () => {
  const { stream, generation, calls } = await startGeneration();
  finishTurn(stream, "The goal.");
  await generation;
  expect(calls().find(({ method }) => method === "turn/start")?.params).toMatchObject({
    outputSchema: null,
  });
});

test("reports a JSON answer of another shape", async () => {
  const { stream, generation } = await startGeneration({}, [], "json");
  finishTurn(stream, '{"name":"Login fix"}');
  await expect(generation).rejects.toThrow(
    "Codex returned an answer that does not fit the output schema",
  );
});

test("reports a JSON answer that is not JSON", async () => {
  const { stream, generation } = await startGeneration({}, [], "json");
  finishTurn(stream, "Login fix");
  await expect(generation).rejects.toThrow("Codex returned an answer that is not JSON");
});
