import {
  claudePermissionModeSchema,
  type ClaudePolicyFields,
  type ClaudeRuntimeConfig,
} from "@openducktor/contracts";
import { z } from "zod";

export type ClaudePolicyFieldPath =
  | "permissionMode"
  | "permissions.allow"
  | "permissions.ask"
  | "permissions.deny"
  | "sandbox.enabled"
  | "sandbox.autoAllowBashIfSandboxed"
  | "sandbox.allowUnsandboxedCommands"
  | "sandbox.excludedCommands"
  | "sandbox.filesystem.allowWrite"
  | "sandbox.filesystem.denyWrite"
  | "sandbox.filesystem.denyRead"
  | "sandbox.filesystem.allowRead"
  | "sandbox.network.allowedDomains"
  | "sandbox.network.deniedDomains"
  | "sandbox.network.strictAllowlist"
  | "sandbox.network.allowLocalBinding"
  | "sandbox.network.allowUnixSockets"
  | "sandbox.network.allowAllUnixSockets";

export const readClaudePolicyField = (policy: ClaudePolicyFields, path: ClaudePolicyFieldPath) => {
  switch (path) {
    case "permissionMode":
      return policy.permissionMode;
    case "permissions.allow":
      return policy.permissions?.allow;
    case "permissions.ask":
      return policy.permissions?.ask;
    case "permissions.deny":
      return policy.permissions?.deny;
    case "sandbox.enabled":
      return policy.sandbox?.enabled;
    case "sandbox.autoAllowBashIfSandboxed":
      return policy.sandbox?.autoAllowBashIfSandboxed;
    case "sandbox.allowUnsandboxedCommands":
      return policy.sandbox?.allowUnsandboxedCommands;
    case "sandbox.excludedCommands":
      return policy.sandbox?.excludedCommands;
    case "sandbox.filesystem.allowWrite":
      return policy.sandbox?.filesystem?.allowWrite;
    case "sandbox.filesystem.denyWrite":
      return policy.sandbox?.filesystem?.denyWrite;
    case "sandbox.filesystem.denyRead":
      return policy.sandbox?.filesystem?.denyRead;
    case "sandbox.filesystem.allowRead":
      return policy.sandbox?.filesystem?.allowRead;
    case "sandbox.network.allowedDomains":
      return policy.sandbox?.network?.allowedDomains;
    case "sandbox.network.deniedDomains":
      return policy.sandbox?.network?.deniedDomains;
    case "sandbox.network.strictAllowlist":
      return policy.sandbox?.network?.strictAllowlist;
    case "sandbox.network.allowLocalBinding":
      return policy.sandbox?.network?.allowLocalBinding;
    case "sandbox.network.allowUnixSockets":
      return policy.sandbox?.network?.allowUnixSockets;
    case "sandbox.network.allowAllUnixSockets":
      return policy.sandbox?.network?.allowAllUnixSockets;
  }
};

const assign = <Owner extends object, Key extends keyof Owner>(
  owner: Owner,
  key: Key,
  value: Owner[Key] | undefined,
): void => {
  if (value === undefined) delete owner[key];
  else owner[key] = value;
};
const listValueSchema = z.array(z.string()).optional();
const booleanValueSchema = z.boolean().optional();

export const updateClaudePolicyField = (
  policy: ClaudePolicyFields,
  path: ClaudePolicyFieldPath,
  value: string | boolean | string[] | undefined,
): ClaudePolicyFields => {
  const next = structuredClone(policy);
  switch (path) {
    case "permissionMode":
      assign(next, "permissionMode", claudePermissionModeSchema.optional().parse(value));
      break;
    case "permissions.allow":
    case "permissions.ask":
    case "permissions.deny": {
      const key = z.enum(["allow", "ask", "deny"]).parse(path.slice("permissions.".length));
      assign((next.permissions ??= {}), key, listValueSchema.parse(value));
      break;
    }
    case "sandbox.enabled":
    case "sandbox.autoAllowBashIfSandboxed":
    case "sandbox.allowUnsandboxedCommands": {
      const key = z
        .enum(["enabled", "autoAllowBashIfSandboxed", "allowUnsandboxedCommands"])
        .parse(path.slice("sandbox.".length));
      assign((next.sandbox ??= {}), key, booleanValueSchema.parse(value));
      break;
    }
    case "sandbox.excludedCommands":
      assign((next.sandbox ??= {}), "excludedCommands", listValueSchema.parse(value));
      break;
    case "sandbox.filesystem.allowWrite":
    case "sandbox.filesystem.denyWrite":
    case "sandbox.filesystem.denyRead":
    case "sandbox.filesystem.allowRead": {
      const key = z
        .enum(["allowWrite", "denyWrite", "denyRead", "allowRead"])
        .parse(path.slice("sandbox.filesystem.".length));
      const sandbox = (next.sandbox ??= {});
      assign((sandbox.filesystem ??= {}), key, listValueSchema.parse(value));
      break;
    }
    case "sandbox.network.allowedDomains":
    case "sandbox.network.deniedDomains":
    case "sandbox.network.allowUnixSockets": {
      const key = z
        .enum(["allowedDomains", "deniedDomains", "allowUnixSockets"])
        .parse(path.slice("sandbox.network.".length));
      const sandbox = (next.sandbox ??= {});
      assign((sandbox.network ??= {}), key, listValueSchema.parse(value));
      break;
    }
    case "sandbox.network.strictAllowlist":
    case "sandbox.network.allowLocalBinding":
    case "sandbox.network.allowAllUnixSockets": {
      const key = z
        .enum(["strictAllowlist", "allowLocalBinding", "allowAllUnixSockets"])
        .parse(path.slice("sandbox.network.".length));
      const sandbox = (next.sandbox ??= {});
      assign((sandbox.network ??= {}), key, booleanValueSchema.parse(value));
      break;
    }
  }
  return next;
};

export const buildNewClaudeDangerousSelectionKey = ({
  baseline,
  draft,
}: {
  baseline: ClaudeRuntimeConfig | null;
  draft: ClaudeRuntimeConfig;
}): string => {
  const collect = (config: ClaudeRuntimeConfig | null) => {
    const keys: string[] = [];
    for (const [scope, policy] of Object.entries({
      defaults: config?.defaults,
      ...config?.roleOverrides,
    })) {
      if (policy?.permissionMode === "bypassPermissions") keys.push(`${scope}.permissionMode`);
      if (policy?.sandbox?.enabled === false) keys.push(`${scope}.sandbox.enabled`);
    }
    return keys;
  };
  const saved = new Set(collect(baseline));
  return collect(draft)
    .filter((key) => !saved.has(key))
    .toSorted()
    .join("|");
};
