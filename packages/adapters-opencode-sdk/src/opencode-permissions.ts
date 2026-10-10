import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import { type OpenCodeClient, type PermissionRule, type SessionInfo } from "@opencode/client";
import {
  type AgentSessionScope,
  type OpenCodeCreationSettings,
  agentRoleSchema,
  OPENCODE_RUNTIME_DESCRIPTOR,
} from "@openducktor/contracts";
import { z } from "zod";
import { operationError, type OperationIdentity } from "./opencode-client";
import { resolveOpencodeSessionPolicy } from "./opencode-session-policy";
import { type OpencodePermissionRule } from "./workflow-tool-permissions";
import { OPENCODE_WORKFLOW_INSTRUCTION_KEY } from "./opencode-session-transcript";
import { OPENCODE_WORKFLOW_PLUGIN_RPC } from "./opencode-workflow-plugin";
import type { OpenCodeRuntimeConnection } from "./types";

const ownershipKey = "openducktor.permissions";
const ruleSchema = z.strictObject({
  permission: z.string(),
  pattern: z.string(),
  action: z.enum(["allow", "ask", "deny"]),
});
const ownershipSchema = z.strictObject({
  version: z.literal(1),
  legacyAmbiguous: z.boolean(),
  inheritancePending: z.boolean().optional(),
  spans: z.array(
    z.strictObject({
      layer: z.enum(["defaults", "role", "mandatory", "inherited"]),
      context: z.string(),
      start: z.number().int().nonnegative(),
      rules: z.array(ruleSchema).min(1),
    }),
  ),
});
type Ownership = z.infer<typeof ownershipSchema>;

const permissionAliases = new Map([
  ["bash", "shell"],
  ["task", "subagent"],
  ["write", "edit"],
  ["patch", "edit"],
  ["apply_patch", "edit"],
]);

export const compilePermissionRule = (rule: OpencodePermissionRule): PermissionRule => {
  if (["list", "doom_loop", "lsp", "subtask"].includes(rule.permission))
    throw new Error(
      `Permission '${rule.permission}' with pattern '${rule.pattern}' has no safe OpenCode V2 equivalent. Edit that saved rule and retry creation or fork.`,
    );
  const action = permissionAliases.get(rule.permission) ?? rule.permission;
  return { action, resource: rule.pattern, effect: rule.action };
};

const nativeEqual = (left: PermissionRule[], right: PermissionRule[]) =>
  left.length === right.length &&
  left.every((rule, index) => {
    const other = right[index];
    return (
      other?.action === rule.action &&
      other.resource === rule.resource &&
      other.effect === rule.effect
    );
  });

const ownershipFailure = (identity: OperationIdentity, reason: string) =>
  operationError(
    identity,
    "fork the conversation",
    "policy_failed",
    reason,
    "The source conversation remains usable. Start a fresh conversation with current settings, or resolve the native permission ownership before retrying fork.",
  );

/** The ownership marker keeps the existing logical rule format and version. */
const readOwnership = (detail: SessionInfo, identity: OperationIdentity): Ownership | null => {
  const value = detail.metadata?.[ownershipKey];
  if (value === undefined) return null;
  const parsed = ownershipSchema.safeParse(value);
  if (!parsed.success)
    throw ownershipFailure(identity, "OpenCode returned malformed permission ownership metadata.");
  let end = 0;
  for (const span of parsed.data.spans) {
    const next = span.start + span.rules.length;
    if (
      span.start < end ||
      !nativeEqual(
        (detail.permissions ?? []).slice(span.start, next),
        span.rules.map(compilePermissionRule),
      )
    )
      throw ownershipFailure(
        identity,
        "The ordered native permissions do not match their ownership marker. Native V1 migration can clear old session permissions.",
      );
    end = next;
  }
  return parsed.data;
};

export const ownedWorkflowRole = (detail: SessionInfo) => {
  const identity = {
    repoPath: detail.location.directory,
    workingDirectory: detail.location.directory,
    externalSessionId: detail.id,
  };
  const value = detail.metadata?.[ownershipKey];
  if (value === undefined) return null;
  const ownership = ownershipSchema.parse(value);
  const span = ownership.spans.findLast((item) => item.layer === "mandatory");
  if (!span || span.context === "repository") return null;
  const permissions = detail.permissions ?? [];
  if (
    span.start + span.rules.length !== permissions.length ||
    !nativeEqual(permissions.slice(span.start), span.rules.map(compilePermissionRule))
  )
    throw operationError(
      identity,
      "verify child workflow controls",
      "policy_failed",
      "The current mandatory workflow permissions do not match their ownership marker.",
      "Reopen the parent workflow through its normal task action, then retry the command.",
    );
  return agentRoleSchema.parse(span.context);
};

export const readWorkflowInstructions = async (
  client: OpenCodeClient,
  identity: OperationIdentity & { externalSessionId: string },
): Promise<string> => {
  const entries = await client.session.instructions.entry.list({
    sessionID: identity.externalSessionId,
  });
  const entry = entries.find((item) => item.key === OPENCODE_WORKFLOW_INSTRUCTION_KEY);
  const prompt = z.string().safeParse(entry?.value);
  if (!prompt.success || !prompt.data.trim())
    throw operationError(
      identity,
      "install workflow instructions",
      "policy_failed",
      "The conversation has no confirmed OpenDucktor workflow instructions.",
      "Reopen this workflow through its normal task action, then retry sending.",
    );
  return prompt.data;
};

export const forkNativePermissions = (
  detail: SessionInfo,
  identity: OperationIdentity,
): PermissionRule[] => {
  const ownership = readOwnership(detail, identity);
  const native = detail.permissions ?? [];
  if (
    ownership?.legacyAmbiguous ||
    ownership?.inheritancePending ||
    (!ownership && native.some((rule) => rule.action.includes("odt_")))
  )
    throw ownershipFailure(identity, "Cannot prove which source permissions OpenDucktor owns.");
  const remaining = ownership
    ? native.filter(
        (_, index) =>
          !ownership.spans.some(
            (span) => index >= span.start && index < span.start + span.rules.length,
          ),
      )
    : native;
  if (remaining.some((rule) => rule.action.includes("odt_")))
    throw ownershipFailure(
      identity,
      "Workflow controls outside the ownership marker have an unknown origin.",
    );
  return remaining;
};

const compilePathRules = async (
  client: OpenCodeClient,
  identity: OperationIdentity,
  rules: OpencodePermissionRule[],
): Promise<OpencodePermissionRule[]> => {
  rules.forEach(compilePermissionRule);
  const hasPathResource = (rule: OpencodePermissionRule) =>
    ["read", "edit", "external_directory"].includes(compilePermissionRule(rule).action);
  if (!rules.some((rule) => hasPathResource(rule) && rule.pattern !== "*")) return rules;
  const location = await client.location.get({
    location: { directory: identity.workingDirectory },
  });
  if (location.directory !== identity.workingDirectory)
    throw operationError(
      identity,
      "compile session permissions",
      "identity_mismatch",
      "The selected native location changed.",
    );
  const path = /^[a-z]:|^\\\\/i.test(location.directory) ? win32 : posix;
  const project = location.project.directory;
  return rules.map((rule) => {
    if (!hasPathResource(rule) || rule.pattern === "*") return rule;
    let pattern = rule.pattern.replace(/^(?:~(?=\/|$)|\$HOME(?=\/|$))/, homedir());
    if (rule.permission !== "external_directory") {
      const absolute = path.isAbsolute(pattern) ? pattern : path.join(project, pattern);
      const prefix = absolute.split(/[*?]/)[0] ?? absolute;
      const relativeToProject = path.relative(project, prefix);
      const inProject =
        !relativeToProject.startsWith(`..${path.sep}`) &&
        relativeToProject !== ".." &&
        !path.isAbsolute(relativeToProject);
      if (/[*?]/.test(absolute) && prefix.length <= project.length && project.startsWith(prefix))
        throw new Error(
          `Cannot preserve permission pattern '${rule.pattern}' across the worktree boundary. Use a location-relative pattern and retry.`,
        );
      pattern = inProject ? path.relative(location.directory, absolute) || "." : absolute;
    }
    return { ...rule, pattern: pattern.replace(/\\/g, "/") };
  });
};

export const compileCreationSettings = async (
  client: OpenCodeClient,
  identity: OperationIdentity,
  settings: OpenCodeCreationSettings,
): Promise<OpenCodeCreationSettings> => {
  const rules = await compilePathRules(client, identity, [...settings.defaults, ...settings.role]);
  return {
    defaults: rules.slice(0, settings.defaults.length),
    role: rules.slice(settings.defaults.length),
  };
};

export const installOpenCodePolicy = async (input: {
  connection: OpenCodeRuntimeConnection;
  client: OpenCodeClient;
  detail: SessionInfo;
  identity: OperationIdentity;
  scope: AgentSessionScope;
  systemPrompt?: string | undefined;
  creationSettings?: OpenCodeCreationSettings;
  native?: PermissionRule[];
}): Promise<void> => {
  const { client, detail, identity, scope, systemPrompt, creationSettings } = input;
  const policy = resolveOpencodeSessionPolicy(
    scope,
    OPENCODE_RUNTIME_DESCRIPTOR,
    "install V2 session controls",
  );
  const mandatory = policy.permission;
  if (scope.kind === "workflow") {
    try {
      z.object({ ready: z.literal(true) }).parse(
        await client
          .rpc(OPENCODE_WORKFLOW_PLUGIN_RPC)
          .bind(input.connection, { location: { directory: identity.workingDirectory } }),
      );
    } catch (cause) {
      throw operationError(
        identity,
        "establish child workflow controls",
        "policy_failed",
        `The owned OpenDucktor workflow instruction plugin is not ready: ${cause instanceof Error ? cause.message : String(cause)}`,
        "Restart the selected OpenCode runtime from Diagnostics, then retry the workflow action.",
      );
    }
  }
  let permissions = [...(input.native ?? detail.permissions ?? [])];
  let ownership: Ownership;
  if (creationSettings) {
    ownership = { version: 1, legacyAmbiguous: false, spans: [] };
    const context = scope.kind === "workflow" ? scope.role : "repository";
    for (const [layer, rules] of [
      ["defaults", creationSettings.defaults],
      ["role", creationSettings.role],
      ["mandatory", mandatory],
    ] as const) {
      const compiled = rules;
      if (compiled.length)
        ownership.spans.push({
          layer,
          context,
          start: permissions.length,
          rules: compiled.map((rule) => ({ ...rule })),
        });
      permissions.push(...compiled.map(compilePermissionRule));
    }
  } else {
    const compiled = mandatory.map(compilePermissionRule);
    const alreadyInstalled = nativeEqual(permissions.slice(-compiled.length), compiled);
    if (!alreadyInstalled) {
      // Never remove unproven native rules during attachment. A stale V1 marker is retained for fork diagnostics.
      const parsed = ownershipSchema.safeParse(detail.metadata?.[ownershipKey]);
      ownership = parsed.success
        ? parsed.data
        : {
            version: 1,
            legacyAmbiguous: permissions.some((rule) => rule.action.includes("odt_")),
            spans: [],
          };
      ownership.spans.push({
        layer: "mandatory",
        context: scope.kind === "workflow" ? scope.role : "repository",
        start: permissions.length,
        rules: mandatory,
      });
      permissions.push(...compiled);
    } else {
      ownership = ownershipSchema.parse(
        detail.metadata?.[ownershipKey] ?? { version: 1, legacyAmbiguous: true, spans: [] },
      );
      const start = permissions.length - compiled.length;
      const context = scope.kind === "workflow" ? scope.role : "repository";
      const span = ownership.spans.at(-1);
      if (
        span?.layer !== "mandatory" ||
        span.context !== context ||
        span.start !== start ||
        span.rules.length !== mandatory.length ||
        !span.rules.every((rule, index) => {
          const expected = mandatory[index];
          return (
            expected?.permission === rule.permission &&
            expected.pattern === rule.pattern &&
            expected.action === rule.action
          );
        })
      )
        ownership.spans.push({ layer: "mandatory", context, start, rules: mandatory });
    }
  }
  if (scope.kind === "workflow") {
    if (systemPrompt !== undefined) {
      if (!systemPrompt.trim())
        throw operationError(
          identity,
          "install workflow instructions",
          "policy_failed",
          "The resolved workflow system prompt is empty.",
          "Restore the workflow prompt in settings, then retry attachment.",
        );
      await client.session.instructions.entry.put({
        sessionID: detail.id,
        key: OPENCODE_WORKFLOW_INSTRUCTION_KEY,
        value: systemPrompt,
      });
    } else {
      await readWorkflowInstructions(client, { ...identity, externalSessionId: detail.id });
    }
  } else if (systemPrompt?.trim()) {
    await client.session.instructions.entry.put({
      sessionID: detail.id,
      key: OPENCODE_WORKFLOW_INSTRUCTION_KEY,
      value: systemPrompt,
    });
  }
  await client.session.update({
    sessionID: detail.id,
    permissions,
    metadata: { ...detail.metadata, [ownershipKey]: z.json().parse(ownership) },
  });
};
