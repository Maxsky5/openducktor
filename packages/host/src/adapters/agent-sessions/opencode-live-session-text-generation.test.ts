import { expect, test } from "bun:test";
import { Effect } from "effect";
import type { AgentSessionLiveAdapterChange } from "../../ports/agent-session-live-adapter-port";
import { builtinWorkflowRolePolicy } from "../../test-support/workflow-role-policy";
import {
  createLifecycle,
  createRuntimeHarness,
  createTestOpenCodeLiveSessionAdapterPreparer,
  ignoreObservationLoss,
  runtime,
} from "./opencode-live-session-adapter.test-support";

test("generates text through the OpenCode runtime connection", async () => {
  const harness = createRuntimeHarness();
  const changes: AgentSessionLiveAdapterChange[] = [];
  const prepared = await Effect.runPromise(
    createTestOpenCodeLiveSessionAdapterPreparer({
      resolveWorkflowRolePolicy: builtinWorkflowRolePolicy,
      liveSessionLifecycle: createLifecycle(changes),
      prepareRuntime: harness.prepareRuntime,
    })(runtime, ignoreObservationLoss),
  );
  const input = {
    repoPath: "/repo",
    model: { runtimeKind: "opencode", providerId: "opencode-go", modelId: "glm-5.3-flash" },
    instructions: "Write one goal.",
    prompt: "Task: Add goals.",
  } as const;
  try {
    const generation = prepared.adapter.textGeneration;
    if (!generation) throw new Error("OpenCode must generate text.");
    expect(await Effect.runPromise(generation.generate(input))).toBe("Generated: Task: Add goals.");
    expect(harness.controlCalls).toEqual([{ operation: "generate", input }]);
    expect(changes).toEqual([]);
  } finally {
    await Effect.runPromise(prepared.adapter.releaseRuntime());
  }
});
