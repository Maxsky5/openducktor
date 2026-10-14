import {
  agentSessionLiveSnapshotSchema,
  type AgentSessionLiveSnapshot,
} from "@openducktor/contracts";
import type { AgentSessionLiveAdapterPort } from "../../ports/agent-session-live-adapter-port";
import { Effect } from "effect";
import type { z } from "zod";
import { HostValidationError } from "../../effect/host-errors";

export const parseAdapterOutput = <Schema extends z.ZodType, Input>(
  schema: Schema,
  value: Input,
  operation: string,
): Effect.Effect<z.output<Schema>, HostValidationError<{ operation: string }>> =>
  Effect.try({
    try: () => schema.parse(value),
    catch: (cause) =>
      new HostValidationError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
        details: { operation },
      }),
  });

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
