import type { AgentRole } from "@openducktor/contracts";
import type { ClaudePolicyFieldPath } from "./settings-claude-policy";

export const CLAUDE_POLICY_ROLES: AgentRole[] = ["spec", "planner", "build", "qa"];

export type ClaudePolicyField = {
  path: ClaudePolicyFieldPath;
  label: string;
  help: string;
  list?: boolean;
};
export const CLAUDE_POLICY_GROUPS: { title: string; fields: ClaudePolicyField[] }[] = [
  {
    title: "Approval behavior",
    fields: [
      {
        path: "permissionMode",
        label: "Approval mode",
        help: "Choose when Claude asks for permission. Managed restrictions and OpenDucktor role limits remain active.",
      },
    ],
  },
  {
    title: "Command sandbox",
    fields: [
      {
        path: "sandbox.enabled",
        label: "Bash sandbox",
        help: "Isolate Bash and its child processes. If enabled isolation is unavailable, the command or launch fails. This does not isolate every file tool, web tool, MCP server, or subagent.",
      },
      {
        path: "sandbox.autoAllowBashIfSandboxed",
        label: "Approve sandboxed commands automatically",
        help: "Separate from the automatic approval classifier and approval mode.",
      },
      {
        path: "sandbox.allowUnsandboxedCommands",
        label: "Allow outside-sandbox requests",
        help: "Let Claude request execution outside the sandbox after a failure. Excluded commands follow their separate native behavior.",
      },
      {
        path: "sandbox.excludedCommands",
        label: "Excluded commands",
        list: true,
        help: "Native command patterns, such as git or docker *. Matching commands run outside the sandbox but still need native permission approval.",
      },
    ],
  },
  {
    title: "Permission rules",
    fields: (["allow", "ask", "deny"] as const).map((action) => ({
      path: `permissions.${action}` as const,
      label: `${action[0]!.toUpperCase()}${action.slice(1)} rules`,
      list: true,
      help: "Deny takes precedence over Ask, then Allow. Allow grants approval, not tool availability. Native rules still apply. File permission patterns use ./ for cwd, // for absolute paths, ~/ for home, and / for the settings source.",
    })),
  },
  {
    title: "Sandbox file access",
    fields: [
      {
        path: "sandbox.filesystem.allowWrite",
        label: "Additional writable paths",
        list: true,
        help: "Native baseline access remains. Sandbox paths differ from file permission rules: relative paths use the launch directory; / is absolute and ~/ is home-relative. Preserve native glob patterns.",
      },
      {
        path: "sandbox.filesystem.denyWrite",
        label: "Denied writable paths",
        list: true,
        help: "Block writes by sandboxed commands and their child processes.",
      },
      {
        path: "sandbox.filesystem.denyRead",
        label: "Denied readable paths",
        list: true,
        help: "Block command reads in these regions.",
      },
      {
        path: "sandbox.filesystem.allowRead",
        label: "Read exceptions",
        list: true,
        help: "Allow command reads inside denied regions, subject to native path specificity and managed policy.",
      },
    ],
  },
  {
    title: "Sandbox network access",
    fields: [
      {
        path: "sandbox.network.allowedDomains",
        label: "Allowed domains",
        list: true,
        help: "Domains and native patterns such as *.example.com for sandboxed commands. Native entries still combine; WebFetch domain rules also affect the sandbox. WebFetch and MCP calls need their own permission rules.",
      },
      {
        path: "sandbox.network.deniedDomains",
        label: "Denied domains",
        list: true,
        help: "Native denials and managed restrictions remain active.",
      },
      {
        path: "sandbox.network.strictAllowlist",
        label: "Block unlisted domains",
        help: "Block traffic outside the allowed list, without requesting access through an approval prompt.",
      },
      {
        path: "sandbox.network.allowLocalBinding",
        label: "Allow local network binding",
        help: "Let sandboxed commands bind local ports where the platform supports it.",
      },
      {
        path: "sandbox.network.allowUnixSockets",
        label: "Permitted Unix sockets",
        list: true,
        help: "Socket paths use the launch directory for relative paths. Native Unix-socket access controls apply on macOS; Linux socket filtering follows its native platform limits.",
      },
      {
        path: "sandbox.network.allowAllUnixSockets",
        label: "Allow all Unix sockets",
        help: "Unrestricted socket access can reach services outside sandbox network limits, including a Docker daemon.",
      },
    ],
  },
];
export const CLAUDE_PERMISSION_MODES = [
  {
    value: "default",
    label: "Standard approvals",
    description: "Ask when native permission checks require approval.",
  },
  {
    value: "acceptEdits",
    label: "Accept edits",
    description: "Approve eligible file edits. Other tools keep native checks.",
  },
  {
    value: "dontAsk",
    label: "Deny instead of asking",
    description: "Deny calls that need a permission prompt.",
  },
  {
    value: "bypassPermissions",
    label: "Bypass permissions",
    description: "Skip routine prompts. Mandatory restrictions remain.",
  },
  {
    value: "auto",
    label: "Automatic approvals",
    description: "Use the native classifier when available. The session reports the applied mode.",
  },
];
