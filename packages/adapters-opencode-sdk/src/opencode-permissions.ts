import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import { type OpenCodeClient, type PermissionRule, type SessionInfo } from "@opencode/client";
import {
  type AgentSessionScope,
  type OpenCodeCreationSettings,
  OPENCODE_RUNTIME_DESCRIPTOR,
} from "@openducktor/contracts";
import { z } from "zod";
import { operationError, type OperationIdentity } from "./opencode-client";
import { resolveOpencodeSessionPolicy } from "./opencode-session-policy";
import { type OpencodePermissionRule } from "./workflow-tool-permissions";
import { OPENCODE_WORKFLOW_INSTRUCTION_KEY } from "./opencode-session-transcript";

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
const unsupportedPermissions = new Set(["list", "doom_loop", "lsp", "subtask"]);

export const compilePermissionRule = (rule: OpencodePermissionRule): PermissionRule => {
  if (unsupportedPermissions.has(rule.permission))
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
  client: OpenCodeClient;
  detail: SessionInfo;
  scope: AgentSessionScope;
  creationSettings?: OpenCodeCreationSettings;
  native?: PermissionRule[];
}): Promise<void> => {
  const { client, detail, scope, creationSettings } = input;
  const policy = resolveOpencodeSessionPolicy(
    scope,
    OPENCODE_RUNTIME_DESCRIPTOR,
    "install V2 session controls",
  );
  const mandatory = policy.permission;
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
    const parsed = ownershipSchema.safeParse(detail.metadata?.[ownershipKey]);
    ownership = parsed.success
      ? parsed.data
      : {
          version: 1,
          legacyAmbiguous: permissions.some((rule) => rule.action.includes("odt_")),
          spans: [],
        };
    const context = scope.kind === "workflow" ? scope.role : "repository";
    // Replace only matching app-owned controls. Keep native rules, saved creation rules,
    // and unproven V1 markers, which still prevent an unsafe fork.
    const replaced = ownership.spans.filter(
      (span) =>
        span.layer === "mandatory" &&
        span.context === context &&
        !span.rules.some((rule) => unsupportedPermissions.has(rule.permission)) &&
        nativeEqual(
          permissions.slice(span.start, span.start + span.rules.length),
          span.rules.map(compilePermissionRule),
        ),
    );
    const removed = new Set<number>();
    for (const span of replaced)
      for (let index = span.start; index < span.start + span.rules.length; index++)
        removed.add(index);
    permissions = permissions.filter((_, index) => !removed.has(index));
    ownership.spans = ownership.spans
      .filter((span) => !replaced.includes(span))
      .map((span) => ({
        ...span,
        start: span.start - [...removed].filter((index) => index < span.start).length,
      }));
    ownership.spans.push({
      layer: "mandatory",
      context,
      start: permissions.length,
      rules: mandatory,
    });
    permissions.push(...mandatory.map(compilePermissionRule));
  }
  await client.session.update({
    sessionID: detail.id,
    permissions,
    metadata: { ...detail.metadata, [ownershipKey]: z.json().parse(ownership) },
  });
};

/**
 * Writes the instructions that the host resolved for a root conversation. Reattachment sends no
 * prompt, so the next new turn writes the current workflow prompt.
 */
export const putOpenCodeInstructions = async (input: {
  client: OpenCodeClient;
  identity: OperationIdentity;
  sessionID: string;
  scope: AgentSessionScope;
  systemPrompt: string | undefined;
}): Promise<void> => {
  const { client, identity, sessionID, scope, systemPrompt } = input;
  if (systemPrompt === undefined) return;
  if (scope.kind === "workflow" && !systemPrompt.trim())
    throw operationError(
      identity,
      "install workflow instructions",
      "policy_failed",
      "The resolved workflow system prompt is empty.",
      "Restore the workflow prompt in settings, then retry.",
    );
  if (systemPrompt.trim())
    await client.session.instructions.entry.put({
      sessionID,
      key: OPENCODE_WORKFLOW_INSTRUCTION_KEY,
      value: systemPrompt,
    });
};

/** Root creation, fork, and reattachment write instructions before input admission. */
export const installOpenCodeRootPolicy = async (
  input: Parameters<typeof installOpenCodePolicy>[0] & {
    identity: OperationIdentity;
    systemPrompt?: string | undefined;
  },
): Promise<void> => {
  await putOpenCodeInstructions({
    client: input.client,
    identity: input.identity,
    sessionID: input.detail.id,
    scope: input.scope,
    systemPrompt: input.systemPrompt,
  });
  await installOpenCodePolicy(input);
};
