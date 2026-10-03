import { expect, test } from "bun:test";
import { Effect } from "effect";
import {
  RUNTIME_DESCRIPTORS_BY_KIND,
  type AgentSessionLiveEnvelope,
  type HostEventEnvelope,
  type RuntimeInstanceSummary,
} from "@openducktor/contracts";
import { createAgentSessionLiveAttachment } from "@openducktor/host-client";
import { createLiveSessionAdapterRegistry } from "../../host/src/adapters/agent-sessions/live-session-adapter-registry";
import { createAgentSessionLiveStateService } from "../../host/src/application/agent-sessions/agent-session-live-state-service";
import { createAgentSessionRuntimeAdapterTestDouble } from "../../host/src/test-support/service-test-doubles";
import {
  createLiveSessionPublisher,
  createRuntimeLifecyclePublisher,
} from "../../host/src/composition/node/runtime-lifecycle-publisher";

const runtime: RuntimeInstanceSummary = {
  runtimeId: "runtime-1",
  kind: "opencode",
  repoPath: "/repo",
  workingDirectory: "/repo",
  role: "workspace",
  taskId: null,
  runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4096" },
  startedAt: "2026-09-12T10:00:00.000Z",
  descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
};

test.each(["ready", "stopped"] as const)(
  "preserves %s published after attachment baseline capture",
  async (state) => {
    const received: AgentSessionLiveEnvelope[] = [];
    const attachment = createAgentSessionLiveAttachment("/repo", (event) => received.push(event));
    const registrations = createLiveSessionAdapterRegistry();
    const eventBus = {
      publish: (event: HostEventEnvelope) => {
        if (event.channel === "openducktor://agent-session-live-event")
          attachment.accept(event.payload);
      },
      subscribe: () => () => {},
    };
    const live = createAgentSessionLiveStateService({
      adapterRegistry: registrations,
      faultLog: () => Effect.void,
      publish: createLiveSessionPublisher(eventBus),
    });
    const old = createAgentSessionRuntimeAdapterTestDouble(
      { repoPath: "/repo", runtimeId: "old", runtimeKind: "opencode" },
      { listSnapshots: () => Effect.succeed([]), releaseRuntime: () => Effect.succeed([]) },
    );
    await Effect.runPromise(live.registerRuntimeAdapter(old));
    const baseline = await Effect.runPromise(live.attach({ repoPath: "/repo" }));
    attachment.install(baseline);
    attachment.restart();
    await Effect.runPromise(live.releaseRuntime("old"));
    const replacement = createAgentSessionRuntimeAdapterTestDouble(
      { repoPath: "/repo", runtimeId: "new", runtimeKind: "opencode" },
      { listSnapshots: () => Effect.succeed([]), releaseRuntime: () => Effect.succeed([]) },
    );
    if (state === "ready") await Effect.runPromise(live.registerRuntimeAdapter(replacement));
    const publish = createRuntimeLifecyclePublisher(live, (error) => Effect.die(error));
    await Effect.runPromise(
      publish({ ...runtime, runtimeId: state === "ready" ? "new" : "old" }, state),
    );
    attachment.install(baseline);
    const last = received.at(-1);
    expect(last).toMatchObject({
      type: "runtime_changed",
      state,
      cursor: { hostEpoch: baseline.cursor.hostEpoch, sequence: baseline.cursor.sequence + 1 },
    });
    if (last?.type === "runtime_changed")
      expect(last.runtimeGeneration).toBe(
        state === "ready" ? replacement.binding.generation : undefined,
      );
    await Effect.runPromise(live.releaseRuntime("new"));
  },
);
