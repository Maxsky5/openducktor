import type { RuntimeHealth, RuntimeKind } from "@openducktor/contracts";
import type { Effect } from "effect";
import type { HostOperationErrorAggregate } from "../effect/host-errors";

export type RuntimeHealthPort = {
  /**
   * Reads the version of an executable with `--version` only. It starts no runtime. Null when
   * the executable reports no version.
   */
  readVersion(kind: RuntimeKind, executablePath: string): Effect.Effect<string | null>;
  /**
   * Validates the executable and runs the protocol probe, which starts a short-lived runtime. A
   * failed validation or probe returns a result with `ok: false`, its error, and the read version.
   */
  getRuntimeHealth(
    kind: RuntimeKind,
    executablePath: string,
  ): Effect.Effect<RuntimeHealth, HostOperationErrorAggregate>;
};
