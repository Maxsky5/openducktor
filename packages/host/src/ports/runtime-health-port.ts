import type { RuntimeHealth, RuntimeKind } from "@openducktor/contracts";
import { Context, type Effect } from "effect";
import type { HostOperationErrorAggregate } from "../effect/host-errors";

export type RuntimeHealthPort = {
  /**
   * Reads the version of an executable with `--version` only. It starts no runtime. Null when
   * the executable reports no version.
   */
  readVersion(kind: RuntimeKind, executablePath: string): Effect.Effect<string | null>;
  /** Validates the executable and runs the protocol probe, which starts a short-lived runtime. */
  getRuntimeHealth(
    kind: RuntimeKind,
    executablePath: string,
  ): Effect.Effect<RuntimeHealth, HostOperationErrorAggregate>;
};

export class RuntimeHealthPortTag extends Context.Service<
  RuntimeHealthPortTag,
  RuntimeHealthPort
>()("@openducktor/host/RuntimeHealthPort") {}
