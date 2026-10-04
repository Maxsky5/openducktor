import { z } from "zod";

/** Native selectors and the inputs OpenCode evaluates. Custom selectors use whole actions. */
export const OPENCODE_PERMISSION_TARGETS = [
  {
    permission: "bash",
    supportsPattern: true,
    label: "Commands",
    patternLabel: "Command pattern",
    help: "OpenCode matches the command. For example: git *",
  },
  {
    permission: "read",
    supportsPattern: true,
    label: "Read files",
    patternLabel: "File path pattern",
    help: "Relative paths use OpenCode's worktree. Home and absolute paths are converted for this session.",
  },
  {
    permission: "edit",
    supportsPattern: true,
    label: "Edit files",
    patternLabel: "File path pattern",
    help: "Includes file creation, editing, and patches. Relative paths use OpenCode's worktree. Home and absolute paths are converted for this session.",
  },
  {
    permission: "glob",
    supportsPattern: true,
    label: "Find files",
    patternLabel: "Glob expression pattern",
    help: "Matches the requested glob expression, not each resulting file path.",
  },
  {
    permission: "grep",
    supportsPattern: true,
    label: "Search file content",
    patternLabel: "Search expression pattern",
    help: "Matches the requested search expression.",
  },
  {
    permission: "list",
    supportsPattern: true,
    label: "List directories",
    patternLabel: "Listing pattern",
    help: "Uses OpenCode's native directory listing pattern.",
  },
  {
    permission: "external_directory",
    supportsPattern: true,
    label: "External directories",
    patternLabel: "Directory pattern",
    help: "Access also requires the applicable tool permission.",
  },
  {
    permission: "webfetch",
    supportsPattern: false,
    label: "Fetch web pages",
    patternLabel: null,
    help: "Controls the webfetch tool. It does not block network access through commands or MCP tools.",
  },
  {
    permission: "websearch",
    supportsPattern: false,
    label: "Search the web",
    patternLabel: null,
    help: "Controls the websearch tool. OpenCode does not expose query rules here.",
  },
  {
    permission: "doom_loop",
    supportsPattern: false,
    label: "Repeated tool calls",
    patternLabel: null,
    help: "OpenCode owns the repetition trigger.",
  },
  {
    permission: "skill",
    supportsPattern: true,
    label: "Skills",
    patternLabel: "Skill name pattern",
    help: "Targets native skill names. This does not install skills.",
  },
  {
    permission: "task",
    supportsPattern: true,
    label: "Subagents",
    patternLabel: "Subagent type pattern",
    help: "Controls the native subagent types this session can launch.",
  },
] as const;

export const openCodePermissionTarget = (permission: string) =>
  OPENCODE_PERMISSION_TARGETS.find((target) => target.permission === permission);

export const openCodePermissionRuleSchema = z
  .object({
    permission: z
      .string()
      .refine((value) => value.trim().length > 0, "Enter a permission or tool selector."),
    pattern: z
      .string()
      .refine((value) => value.trim().length > 0, "Enter a pattern; use * to match all inputs."),
    action: z.enum(["allow", "ask", "deny"]),
  })
  .strict()
  .superRefine((rule, context) => {
    if (!openCodePermissionTarget(rule.permission)?.supportsPattern && rule.pattern !== "*") {
      context.addIssue({
        code: "custom",
        path: ["pattern"],
        message: "This selector supports only a whole-permission action. Use * as its pattern.",
      });
    }
  });

export type OpenCodePermissionRule = z.infer<typeof openCodePermissionRuleSchema>;
export const openCodePermissionRulesSchema = z
  .object({ rules: z.array(openCodePermissionRuleSchema).default([]) })
  .strict();
export type OpenCodeCreationSettings = {
  defaults: OpenCodePermissionRule[];
  role: OpenCodePermissionRule[];
};
