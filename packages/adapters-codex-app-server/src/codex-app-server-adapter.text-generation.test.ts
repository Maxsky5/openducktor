import { expect, test } from "bun:test";
import {
  codexTurnFixture,
  createHarness,
  createRuntimeStreamSubscription,
  flushCodexAdapterWork,
} from "./codex-app-server-adapter.test-harness";

const THREAD_ID = "thread/start-runtime-live";
const input = {
  repoPath: "/repo",
  model: { runtimeKind: "codex", providerId: "openai", modelId: "gpt-5", variant: "low" },
  instructions: "Write one goal.",
  prompt: "Task: Add goals.",
} as const;

const startGeneration = async () => {
  const stream = createRuntimeStreamSubscription();
  const harness = createHarness({ subscribeEvents: stream.subscribeEvents });
  const generation = harness.adapter.generateText("runtime-live", input);
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
    effort: "low",
  });
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
