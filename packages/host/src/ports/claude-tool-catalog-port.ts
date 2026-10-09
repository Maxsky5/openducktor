import type { ClaudeToolCatalog, ClaudeToolCatalogInput } from "@openducktor/contracts";
import type { Effect } from "effect";
import type { HostError } from "../effect/host-errors";

export type ClaudeToolCatalogPort = {
  load(input: ClaudeToolCatalogInput): Effect.Effect<ClaudeToolCatalog, HostError>;
};
