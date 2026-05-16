import type { RuntimeHealth, RuntimeKind } from "@openducktor/contracts";
import type { Effect } from "effect";
import type { HostOperationError } from "../effect/host-errors";

export type RuntimeHealthPort = {
  getRuntimeHealth(kind: RuntimeKind): Effect.Effect<RuntimeHealth, HostOperationError>;
};
