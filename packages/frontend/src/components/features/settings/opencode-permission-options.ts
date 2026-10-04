import { OPENCODE_PERMISSION_TARGETS, type OpenCodePermissionRule } from "@openducktor/contracts";

export const NEW_RULE = {
  permission: "bash",
  pattern: "*",
  action: "ask",
} satisfies OpenCodePermissionRule;
export const ROLE_OPTIONS = [
  { value: "inherit", label: "Inherited", description: "Use the default rules for this role." },
  {
    value: "custom",
    label: "Use role rules",
    description: "Add rules after the defaults for this role.",
  },
];

export const TARGET_OPTIONS = [
  ...OPENCODE_PERMISSION_TARGETS.map((target) => ({
    value: target.permission,
    label: target.label,
  })),
  {
    value: "custom",
    label: "Tools and MCP tools",
    description: "A native tool selector, server-prefixed selector, wildcard, or * for all tools.",
  },
];
export const ACTION_OPTIONS = [
  { value: "allow", label: "Allow", description: "Run without approval from this rule." },
  { value: "ask", label: "Ask", description: "Wait for approval." },
  { value: "deny", label: "Deny", description: "Block the action." },
];
