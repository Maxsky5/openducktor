import type { AgentGeneratedImageReadResult } from "@openducktor/contracts";
import type { AgentGeneratedImageSource } from "@openducktor/core";
import type { Effect } from "effect";
import type { HostError } from "../effect/host-errors";

export type GeneratedImagePayload = Pick<
  AgentGeneratedImageReadResult,
  "mime" | "byteLength" | "base64"
>;
export type GeneratedImageFilePort = {
  read(
    source: AgentGeneratedImageSource,
    itemId: string,
  ): Effect.Effect<GeneratedImagePayload, HostError>;
};
