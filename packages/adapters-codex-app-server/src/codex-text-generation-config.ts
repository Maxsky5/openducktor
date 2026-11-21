import type { CodexAppServerConfigReadResponse } from "@openducktor/contracts";
import { z } from "zod";

/**
 * The features that register a model tool in Codex (`codex-rs/core/src/tools/spec_plan.rs`,
 * `codex-rs/tools/src/tool_config.rs`, and the extensions in `codex-rs/ext`), plus the features
 * that the temporary structured threads of Codex turn off.
 */
const DISABLED_FEATURES = [
  "apps",
  "code_mode",
  "code_mode_only",
  "code_mode_tool_search",
  "context_management",
  "current_time_reminder",
  "default_mode_request_user_input",
  "deferred_executor",
  "enable_fanout",
  "goals",
  "hooks",
  "image_generation",
  "memories",
  "multi_agent",
  "multi_agent_v2",
  "plugin_hooks",
  "plugins",
  "request_permissions_tool",
  "send_message_to_user_async",
  "shell_snapshot",
  "shell_tool",
  "sleep_tool",
  "standalone_web_search",
  "token_budget",
  "tool_suggest",
  "unified_exec",
  "view_image",
  "web_search_cached",
  "web_search_request",
] as const;

/**
 * Legacy names that Codex still reads for the turned-off features (`codex-rs/features/src/legacy.rs`):
 * `codex_hooks` is `hooks`, `collab` is `multi_agent`, `connectors` is `apps`,
 * `experimental_use_unified_exec_tool` is `unified_exec`, `imagegenext` is `image_generation`, and
 * `web_search` is `web_search_request`. A managed setting can use them.
 */
const LEGACY_FEATURE_NAMES = [
  "codex_hooks",
  "collab",
  "connectors",
  "experimental_use_unified_exec_tool",
  "imagegenext",
  "web_search",
] as const;

/**
 * Hooks and the legacy notify command run commands that the organization or the user configured,
 * not the model. Managed settings may keep managed hooks on, as in every Codex session on the
 * machine, but only with `allowManagedHooksOnly`: without it, a forced hook feature also runs the
 * hooks of the user and the project (`codex-rs/hooks/src/engine/discovery.rs`).
 */
const HOOK_FEATURE_NAMES = new Set(["hooks", "plugin_hooks", "codex_hooks"]);

/** Every feature name that gives the model a tool, a child agent, or web search. */
const ISOLATION_FEATURE_NAMES: readonly string[] = [
  ...DISABLED_FEATURES,
  ...LEGACY_FEATURE_NAMES,
].filter((name) => !HOOK_FEATURE_NAMES.has(name));

/**
 * Thread config overrides of a text generation, as in the temporary structured threads of Codex
 * (`codex-rs/tui/src/temporary_structured_request.rs`). They turn off hooks, plugins, apps, and the
 * tool features. `notify = []` turns off the legacy notify command, which the hooks feature does
 * not cover. Codex merges a table override into the configuration, so `mcp_servers` turns off each
 * named server and keeps its other settings. Codex warns about a feature key that it does not know
 * and ignores it.
 */
export const codexTextGenerationConfig = (configuredMcpServers: readonly string[]) => ({
  ...Object.fromEntries(DISABLED_FEATURES.map((feature) => [`features.${feature}`, false])),
  notify: [],
  // A model catalog entry can turn on multi-agent tools before the feature flags apply, so
  // `agents.enabled` turns child agents off too.
  "agents.enabled": false,
  web_search: "disabled",
  "tools.update_plan.enabled": false,
  "tools.experimental_request_user_input.enabled": false,
  "skills.include_instructions": false,
  "cloud.skills.enabled": false,
  mcp_servers: Object.fromEntries(configuredMcpServers.map((name) => [name, { enabled: false }])),
});

/** Config layers that Codex applies after the thread overrides, so they can undo them. */
const LAYERS_ABOVE_THREAD_OVERRIDES = new Set([
  "legacyManagedConfigTomlFromFile",
  "legacyManagedConfigTomlFromMdm",
]);

/** The settings of a config layer that can give the model a tool, a child agent, or MCP. */
const isolationSettingsSchema = z.object({
  features: z.record(z.string(), z.unknown()).optional(),
  agents: z.object({ enabled: z.unknown().optional() }).optional(),
  mcp_servers: z.record(z.string(), z.unknown()).optional(),
  web_search: z.unknown().optional(),
  tools: z.record(z.string(), z.unknown()).optional(),
});

/** The first setting that undoes an isolation override, or null. */
const settingThatUndoesIsolation = ({
  features = {},
  agents,
  mcp_servers: servers = {},
  web_search: webSearch,
  tools = {},
}: z.infer<typeof isolationSettingsSchema>): string | null => {
  // A layer that sets one of these to false keeps it off, as the thread overrides do.
  const feature = ISOLATION_FEATURE_NAMES.find(
    (name) => features[name] !== undefined && features[name] !== false,
  );
  if (feature !== undefined) return `features.${feature}`;
  if (agents?.enabled !== undefined && agents.enabled !== false) return "agents.enabled";
  if (Object.keys(servers).length > 0) return "mcp_servers";
  if (webSearch !== undefined && webSearch !== "disabled") return "web_search";
  // Every `tools` entry turns a model tool on or tunes it, such as `update_plan` or `web_search`.
  const tool = Object.keys(tools)[0];
  if (tool !== undefined) return `tools.${tool}`;
  return null;
};

type ManagedFeatures = NonNullable<z.infer<typeof isolationSettingsSchema>["features"]>;

/** A hook feature that managed requirements pin on, or that a legacy managed layer sets. */
const forcedHookFeature = (
  featureRequirements: Readonly<Record<string, boolean>> | null | undefined,
  managedFeatures: readonly ManagedFeatures[],
): string | undefined =>
  [...HOOK_FEATURE_NAMES].find(
    (name) =>
      featureRequirements?.[name] === true ||
      managedFeatures.some((features) => features[name] === true),
  );

/**
 * Why Codex cannot run a text generation in isolation, or null. Managed requirements can pin a
 * feature on, and a legacy managed config layer applies after the thread overrides. Either one can
 * give the model a tool, a child agent, MCP, or web search back, so OpenDucktor does not start the
 * thread. Managed hooks and notify commands may stay on: the organization configured them.
 */
export const codexIsolationProblem = ({
  featureRequirements,
  allowManagedHooksOnly,
  layers,
}: {
  featureRequirements: Readonly<Record<string, boolean>> | null | undefined;
  allowManagedHooksOnly: boolean | null | undefined;
  layers: NonNullable<CodexAppServerConfigReadResponse["layers"]>;
}): string | null => {
  const ask = "Use a model of another runtime, or ask your administrator.";
  const pinned = ISOLATION_FEATURE_NAMES.find((name) => featureRequirements?.[name] === true);
  if (pinned !== undefined)
    return `The managed Codex requirements of this machine turn on the feature ${pinned}, which OpenDucktor must turn off for a text generation. ${ask}`;
  const managedFeatures: ManagedFeatures[] = [];
  for (const layer of layers) {
    if (!LAYERS_ABOVE_THREAD_OVERRIDES.has(layer.name.type) || layer.disabledReason) continue;
    const parsed = isolationSettingsSchema.safeParse(layer.config);
    // A layer whose shape OpenDucktor cannot read can still turn a feature on.
    const setting = parsed.success
      ? settingThatUndoesIsolation(parsed.data)
      : "settings that OpenDucktor cannot read";
    if (setting !== null)
      return `The managed Codex configuration of this machine sets ${setting}, which OpenDucktor must turn off for a text generation. ${ask}`;
    if (parsed.success && parsed.data.features) managedFeatures.push(parsed.data.features);
  }
  const hooks = forcedHookFeature(featureRequirements, managedFeatures);
  if (hooks !== undefined && allowManagedHooksOnly !== true)
    return `The managed Codex settings of this machine turn on the feature ${hooks} without allow_managed_hooks_only, so hooks of the user and the project would run in a text generation. ${ask}`;
  return null;
};
