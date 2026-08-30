import type { RuntimeHealth, RuntimeKind } from "@openducktor/contracts";
import { Context, type Effect } from "effect";
import type { HostOperationErrorAggregate } from "../effect/host-errors";

export type RuntimeHealthPort = {
  getRuntimeHealth(
    kind: RuntimeKind,
    executablePath: string,
  ): Effect.Effect<RuntimeHealth, HostOperationErrorAggregate>;
};

export class RuntimeHealthPortTag extends Context.Tag("@openducktor/host/RuntimeHealthPort")<
  RuntimeHealthPortTag,
  RuntimeHealthPort
>() {}
