import { z } from "zod";
import type { AgentRole } from "./agent-workflow-schemas";

export const CLAUDE_PERMISSION_MODE_VALUES = [
  "default",
  "acceptEdits",
  "dontAsk",
  "bypassPermissions",
  "auto",
] as const;
export const claudePermissionModeSchema = z.enum(CLAUDE_PERMISSION_MODE_VALUES);
export type ClaudePermissionAction = "allow" | "ask" | "deny";

// Validate syntax only. Claude owns matching, trust filtering, and precedence.
export const validateClaudePermissionRule = (
  rule: string,
  action: ClaudePermissionAction,
): string | null => {
  const match = /^([A-Za-z_*?][A-Za-z0-9_.*?-]*)(?:\((.+)\))?$/.exec(rule);
  if (!match || /[\r\n\0]/.test(rule))
    return "Use Tool or Tool(specifier), without blank names or specifiers.";
  const tool = match[1]!;
  const specifier = match[2];
  if (tool.startsWith("mcp__") && specifier !== undefined)
    return "MCP settings rules cannot have specifiers. Use mcp__server__tool or mcp__server__*.";
  if (action === "allow" && /[*?]/.test(tool) && !/^mcp__[^*?]+__.+$/.test(tool))
    return "Allow tool wildcards must name a fixed MCP server, such as mcp__github__*.";
  if (specifier === undefined) return null;
  if (!specifier.trim()) return "Specifier cannot be blank.";
  const parameter = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/.exec(specifier);
  const primaryFields = {
    Bash: "command",
    PowerShell: "command",
    Read: "file_path",
    Edit: "file_path",
    Write: "file_path",
    Grep: "path",
    Glob: "path",
    NotebookEdit: "notebook_path",
    WebFetch: "url",
  };
  const primaryField = Object.entries(primaryFields).find(([name]) => name === tool)?.[1];
  if (parameter && parameter[1] === primaryField)
    return "Native rules ignore this primary input parameter. Use Bash(command), Read(path), Edit(path), or WebFetch(domain:host).";
  if (tool === "WebFetch" && /^https?:\/\//.test(specifier))
    return "Use WebFetch(domain:example.com), without a URL scheme.";
  // Native Ask and Deny support scalar parameters on built-in tools.
  if (action !== "allow" && parameter && !(tool === "WebFetch" && parameter[1] === "domain"))
    return null;
  if (["Write", "NotebookEdit", "MultiEdit", "Grep", "Glob"].includes(tool))
    return "Use Read(path) for reads or Edit(path) for all file writes.";
  if (tool === "Agent" && (action !== "deny" || parameter))
    return "Use Deny for Agent(name), or the whole Agent tool. Parameter rules support Ask and Deny only.";
  if (tool === "WebFetch" && !/^domain:[^\s/:()]+$/.test(specifier))
    return "Use WebFetch(domain:example.com).";
  if (
    action === "allow" &&
    !["Bash", "PowerShell", "Read", "Edit", "WebFetch", "Agent", "Skill"].includes(tool)
  )
    return "This tool does not support Allow specifiers. Use its whole tool name.";
  if (
    action !== "allow" &&
    !["Bash", "PowerShell", "Read", "Edit", "WebFetch", "Agent", "Skill", "Cd"].includes(tool) &&
    !/^[A-Za-z_][A-Za-z0-9_]*\s*:\s*.+$/.test(specifier)
  )
    return "This tool supports whole-tool rules or a native parameter:value Ask or Deny rule.";
  return null;
};

const entries = z.array(
  z
    .string()
    .min(1)
    .refine(
      (value) => value.trim().length > 0 && !value.includes("\0"),
      "Entry cannot be blank or contain a null character.",
    ),
);
const domains = entries.superRefine((values, context) => {
  values.forEach((value, index) => {
    if (/[\s/]/.test(value))
      context.addIssue({
        code: "custom",
        path: [index],
        message:
          "Use a native domain pattern or IP address, with an optional port, without a URL scheme or path.",
      });
  });
});
const rules = (action: ClaudePermissionAction) =>
  entries.superRefine((values, context) => {
    values.forEach((value, index) => {
      const message = validateClaudePermissionRule(value, action);
      if (message) context.addIssue({ code: "custom", path: [index], message });
    });
  });

export const claudePolicyFieldsSchema = z.strictObject({
  permissionMode: claudePermissionModeSchema.optional(),
  permissions: z
    .strictObject({
      allow: rules("allow").optional(),
      ask: rules("ask").optional(),
      deny: rules("deny").optional(),
    })
    .optional(),
  sandbox: z
    .strictObject({
      enabled: z.boolean().optional(),
      autoAllowBashIfSandboxed: z.boolean().optional(),
      allowUnsandboxedCommands: z.boolean().optional(),
      excludedCommands: entries.optional(),
      filesystem: z
        .strictObject({
          allowWrite: entries.optional(),
          denyWrite: entries.optional(),
          denyRead: entries.optional(),
          allowRead: entries.optional(),
        })
        .optional(),
      network: z
        .strictObject({
          allowedDomains: domains.optional(),
          deniedDomains: domains.optional(),
          strictAllowlist: z.boolean().optional(),
          allowLocalBinding: z.boolean().optional(),
          allowUnixSockets: entries.optional(),
          allowAllUnixSockets: z.boolean().optional(),
        })
        .optional(),
    })
    .optional(),
});
export type ClaudePolicyFields = z.infer<typeof claudePolicyFieldsSchema>;
export type ClaudePolicySource = "role" | "default" | "native";

export const resolveClaudePolicy = (
  config: {
    defaults: ClaudePolicyFields;
    roleOverrides: Partial<Record<AgentRole, ClaudePolicyFields>>;
  },
  role?: AgentRole | null,
) => {
  const defaults = config.defaults;
  const override = role ? config.roleOverrides[role] : undefined;
  const sources: Record<string, ClaudePolicySource> = {};
  const copy = <Owner extends object, Key extends keyof Owner>(
    owner: Owner,
    key: Key,
    inherited: Owner[Key] | undefined,
    explicit: Owner[Key] | undefined,
    path: string,
  ): void => {
    sources[path] =
      explicit !== undefined ? "role" : inherited !== undefined ? "default" : "native";
    const value = explicit === undefined ? inherited : explicit;
    if (value !== undefined) owner[key] = structuredClone(value);
  };
  const settings: ClaudePolicyFields = {};
  copy(
    settings,
    "permissionMode",
    defaults.permissionMode,
    override?.permissionMode,
    "permissionMode",
  );
  const permissions: NonNullable<ClaudePolicyFields["permissions"]> = {};
  for (const key of ["allow", "ask", "deny"] as const)
    copy(
      permissions,
      key,
      defaults.permissions?.[key],
      override?.permissions?.[key],
      `permissions.${key}`,
    );
  if (Object.keys(permissions).length) settings.permissions = permissions;
  const sandbox: NonNullable<ClaudePolicyFields["sandbox"]> = {};
  for (const key of [
    "enabled",
    "autoAllowBashIfSandboxed",
    "allowUnsandboxedCommands",
    "excludedCommands",
  ] as const)
    copy(sandbox, key, defaults.sandbox?.[key], override?.sandbox?.[key], `sandbox.${key}`);
  const filesystem: NonNullable<typeof sandbox.filesystem> = {};
  for (const key of ["allowWrite", "denyWrite", "denyRead", "allowRead"] as const)
    copy(
      filesystem,
      key,
      defaults.sandbox?.filesystem?.[key],
      override?.sandbox?.filesystem?.[key],
      `sandbox.filesystem.${key}`,
    );
  if (Object.keys(filesystem).length) sandbox.filesystem = filesystem;
  const network: NonNullable<typeof sandbox.network> = {};
  for (const key of [
    "allowedDomains",
    "deniedDomains",
    "strictAllowlist",
    "allowLocalBinding",
    "allowUnixSockets",
    "allowAllUnixSockets",
  ] as const)
    copy(
      network,
      key,
      defaults.sandbox?.network?.[key],
      override?.sandbox?.network?.[key],
      `sandbox.network.${key}`,
    );
  if (Object.keys(network).length) sandbox.network = network;
  if (Object.keys(sandbox).length) settings.sandbox = sandbox;
  return { settings, sources };
};
