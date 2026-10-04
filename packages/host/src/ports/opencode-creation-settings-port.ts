import type { AgentSessionScope, OpenCodeCreationSettings } from "@openducktor/contracts";
import type { Effect } from "effect";
import type { SettingsConfigError } from "./settings-config-port";

export type OpenCodeCreationSettingsPort = {
  resolve(scope: AgentSessionScope): Effect.Effect<OpenCodeCreationSettings, SettingsConfigError>;
};
