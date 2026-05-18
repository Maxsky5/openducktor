import type { RuntimeHealth, RuntimeKind } from "@openducktor/contracts";
import { Context, type Effect } from "effect";
import type { HostOperationError } from "../effect/host-errors";

export type RuntimeHealthPort = {
  getRuntimeHealth(kind: RuntimeKind): Effect.Effect<RuntimeHealth, HostOperationError>;
};

export class RuntimeHealthPortTag extends Context.Tag("@openducktor/host/RuntimeHealthPort")<
  RuntimeHealthPortTag,
  RuntimeHealthPort
>() {}
