import {
  agentRuntimeConfigSchema,
  claudeRuntimeConfigSchema,
  codexPolicyFieldsSchema,
  codexRuntimeConfigSchema,
  openCodeRuntimeConfigSchema,
  type AgentRuntimeConfig,
} from "@openducktor/contracts";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import { validateHostSettings } from "./sqlite-host-settings-store-validation";
import type { HostDatabaseSession } from "./sqlite-host-database-schema";
import * as schema from "./sqlite-host-settings-schema";

const operation = "hostSettings.runtimePolicies";
const storedCodexRuntimeSchema = codexRuntimeConfigSchema.extend({
  defaults: codexPolicyFieldsSchema.extend({
    sandboxMode: codexPolicyFieldsSchema.shape.sandboxMode.removeDefault(),
    approvalPolicy: codexPolicyFieldsSchema.shape.approvalPolicy.removeDefault(),
    approvalsReviewer: codexPolicyFieldsSchema.shape.approvalsReviewer.removeDefault(),
    commandNetworkAccess: codexPolicyFieldsSchema.shape.commandNetworkAccess.removeDefault(),
  }),
  roleOverrides: codexRuntimeConfigSchema.shape.roleOverrides.removeDefault(),
});
const storedClaudeRuntimeSchema = claudeRuntimeConfigSchema.extend({
  defaults: claudeRuntimeConfigSchema.shape.defaults.removeDefault(),
  roleOverrides: claudeRuntimeConfigSchema.shape.roleOverrides.removeDefault(),
});
const openCodePolicySchema = openCodeRuntimeConfigSchema.shape.defaults.removeDefault();
const storedOpenCodePolicySchema = openCodePolicySchema.extend({
  rules: openCodePolicySchema.shape.rules.removeDefault(),
});
const storedOpenCodeRuntimeSchema = openCodeRuntimeConfigSchema.extend({
  defaults: storedOpenCodePolicySchema,
  roleOverrides: z.partialRecord(
    openCodeRuntimeConfigSchema.shape.roleOverrides.removeDefault().keyType,
    storedOpenCodePolicySchema,
  ),
});
const storedPolicySchema = z.strictObject({ defaults: z.unknown(), roleOverrides: z.unknown() });
const storedRuntimeSchemas = {
  codex: storedCodexRuntimeSchema,
  claude: storedClaudeRuntimeSchema,
  opencode: storedOpenCodeRuntimeSchema,
};
const storedRuntimesSchema = z.object(storedRuntimeSchemas).catchall(agentRuntimeConfigSchema);

export const readRuntimePolicies = (session: HostDatabaseSession) =>
  Effect.gen(function* () {
    const rows = yield* session.execute(
      (db) => db.select().from(schema.agentRuntimeSettings),
      operation,
    );
    return yield* validateHostSettings(
      () =>
        storedRuntimesSchema.parse(
          Object.fromEntries(
            rows.map(({ runtimeKind, policyJson, enabled, executablePath }) => {
              const runtime = { enabled, executablePath };
              if (policyJson === null) return [runtimeKind, runtime];
              return [
                runtimeKind,
                { ...runtime, ...storedPolicySchema.parse(JSON.parse(policyJson)) },
              ];
            }),
          ),
        ),
      "runtime settings",
    );
  });

export const replaceRuntimeSettings = (
  session: HostDatabaseSession,
  runtimeKind: string,
  value: AgentRuntimeConfig | undefined,
) =>
  Effect.gen(function* () {
    if (!value) {
      yield* session.execute(
        (db) =>
          db
            .delete(schema.agentRuntimeSettings)
            .where(eq(schema.agentRuntimeSettings.runtimeKind, runtimeKind)),
        operation,
      );
      return;
    }
    const config = yield* validateHostSettings(
      () => parseRuntimeConfig(runtimeKind, value),
      `${runtimeKind} runtime settings`,
    );
    const settings = {
      enabled: config.enabled,
      executablePath: config.executablePath,
      policyJson:
        "defaults" in config
          ? JSON.stringify({ defaults: config.defaults, roleOverrides: config.roleOverrides })
          : null,
    };
    yield* session.execute(
      (db) =>
        db
          .insert(schema.agentRuntimeSettings)
          .values({ runtimeKind, ...settings })
          .onConflictDoUpdate({ target: schema.agentRuntimeSettings.runtimeKind, set: settings }),
      operation,
    );
  });

const parseRuntimeConfig = (runtimeKind: string, value: AgentRuntimeConfig): AgentRuntimeConfig => {
  if (!Object.hasOwn(storedRuntimeSchemas, runtimeKind))
    return agentRuntimeConfigSchema.parse(value);
  // SAFETY: The own-key check limits runtimeKind to the stored schema keys.
  return storedRuntimeSchemas[runtimeKind as keyof typeof storedRuntimeSchemas].parse(value);
};
