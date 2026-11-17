import {
  agentSessionLiveSnapshotSchema,
  type AgentSessionLiveSnapshot,
} from "@openducktor/contracts";
import type { AgentSessionLiveAdapterPort } from "../../ports/agent-session-live-adapter-port";
import { Effect } from "effect";
import { parseAdapterOutput } from "../../effect/zod-output";

export const readAdapterSnapshots = (
  adapters: ReadonlyArray<AgentSessionLiveAdapterPort>,
  include: (snapshot: AgentSessionLiveSnapshot) => boolean,
) =>
  Effect.gen(function* () {
    const snapshots = yield* Effect.forEach(adapters, (adapter) => adapter.listSnapshots());
    return yield* Effect.forEach(snapshots.flat().filter(include), (snapshot) =>
      parseAdapterOutput(agentSessionLiveSnapshotSchema, snapshot, "agent-session-live.list"),
    );
  });
