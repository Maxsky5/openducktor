import type { RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentApprovalMutation, AgentRole } from "../types/agent-orchestrator";
import { isOdtWorkflowMutationToolName, normalizeOdtWorkflowToolName } from "./odt-workflow-tools";

const MUTATING_NAME_HINTS = [
  "write",
  "edit",
  "patch",
  "delete",
  "rename",
  "move",
  "mkdir",
  "create",
  "chmod",
  "chown",
  "truncate",
];

const MUTATING_TOOL_NAMES = new Set([
  "edit",
  "write",
  "create",
  "delete",
  "multiedit",
  "apply_patch",
  "str_replace",
  "build_blocked",
  "build_resumed",
  "build_completed",
]);

const SAFE_READ_TOOL_NAMES = new Set([
  "read",
  "view",
  "cat",
  "list",
  "ls",
  "glob",
  "grep",
  "find",
  "search",
]);

const SHELL_NAME_HINTS = ["bash", "shell", "exec", "command"];

const MUTATING_SHELL_PATTERNS = [
  /\b(rm|mv|cp|mkdir|rmdir|touch|chmod|chown|truncate)\b/,
  /\b(git\s+(add|commit|push|pull|merge|rebase|checkout|switch|reset|clean|stash))\b/,
  /\b(sed\s+-i|perl\s+-i)\b/,
  />\s*[^=]/,
  />>/,
  /\btee\b/,
];

const SAFE_READ_SHELL_PATTERNS = [
  /^cat\b/,
  /^sed\s+-n\b/,
  /^head\b/,
  /^tail\b/,
  /^less\b/,
  /^more\b/,
  /^ls\b/,
  /^rg\b/,
  /^grep\b/,
  /^find\b/,
  /^git\s+(status|show|log|diff)\b/,
  /^pwd\b/,
  /^wc\b/,
  /^stat\b/,
  /^readlink\b/,
  /^test\b/,
  /^echo\b/,
  /^printf\b/,
];

type WorkflowToolAliasesByCanonical = RuntimeDescriptor["workflowToolAliasesByCanonical"];

export const READ_ONLY_AGENT_ROLES = [
  "spec",
  "planner",
  "qa",
] as const satisfies readonly AgentRole[];
export const READ_ONLY_AGENT_ROLE_SET = new Set<AgentRole>(READ_ONLY_AGENT_ROLES);

export const isReadOnlyAgentRole = (role: AgentRole): boolean => READ_ONLY_AGENT_ROLE_SET.has(role);

const includesMutatingNameHint = (value: string): boolean =>
  MUTATING_NAME_HINTS.some((hint) => value.includes(hint));

const includesShellNameHint = (value: string): boolean =>
  SHELL_NAME_HINTS.some((hint) => value.includes(hint));

export const isSafeReadToolName = (toolName: string): boolean =>
  SAFE_READ_TOOL_NAMES.has(toolName.trim().toLowerCase());

const classifyToolName = (
  toolName: string | undefined,
  workflowToolAliasesByCanonical?: WorkflowToolAliasesByCanonical,
): AgentApprovalMutation | null => {
  const trimmedToolName = toolName?.trim();
  if (!trimmedToolName) {
    return null;
  }

  if (isOdtWorkflowMutationToolName(trimmedToolName, workflowToolAliasesByCanonical)) {
    return "mutating";
  }
  if (normalizeOdtWorkflowToolName(trimmedToolName, workflowToolAliasesByCanonical)) {
    return "read_only";
  }

  const lowerToolName = trimmedToolName.toLowerCase();
  if (MUTATING_TOOL_NAMES.has(lowerToolName) || includesMutatingNameHint(lowerToolName)) {
    return "mutating";
  }
  if (isSafeReadToolName(lowerToolName)) {
    return "read_only";
  }

  return null;
};

const isReadOnlyShellSegment = (value: string): boolean => {
  const segment = value.trim();
  return segment.length > 0 && SAFE_READ_SHELL_PATTERNS.some((pattern) => pattern.test(segment));
};

const splitShellCommandSegments = (command: string): string[] | null => {
  const segments: string[] = [];
  let segment = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  const pushSegment = (): void => {
    const trimmed = segment.trim();
    if (trimmed.length > 0) {
      segments.push(trimmed);
    }
    segment = "";
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];

    if (escaped) {
      segment += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      segment += character;
      escaped = true;
      continue;
    }
    if (quote) {
      segment += character;
      if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      segment += character;
      quote = character;
      continue;
    }
    if (character === "&" && command[index + 1] === "&") {
      pushSegment();
      index += 1;
      continue;
    }
    if (character === "|" && command[index + 1] === "|") {
      pushSegment();
      index += 1;
      continue;
    }
    if (character === ";" || character === "\n") {
      pushSegment();
      continue;
    }

    segment += character;
  }

  if (escaped || quote) {
    return null;
  }
  pushSegment();
  return segments;
};

export const isReadOnlyShellCommand = (command: string): boolean => {
  const normalized = command.trim().toLowerCase();
  if (normalized.length === 0) {
    return false;
  }
  if (MUTATING_SHELL_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  const segments = splitShellCommandSegments(normalized);
  return segments !== null && segments.length > 0 && segments.every(isReadOnlyShellSegment);
};

type ApprovalMutationClassificationInput = {
  actionName?: string | undefined;
  toolName?: string | undefined;
  affectedPaths?: readonly string[];
  command?: string | undefined;
  workflowToolAliasesByCanonical?: WorkflowToolAliasesByCanonical;
};

export const classifyAgentApprovalMutation = ({
  actionName,
  toolName,
  affectedPaths = [],
  command,
  workflowToolAliasesByCanonical,
}: ApprovalMutationClassificationInput): AgentApprovalMutation => {
  for (const name of [actionName, toolName]) {
    const mutation = classifyToolName(name, workflowToolAliasesByCanonical);
    if (mutation) {
      return mutation;
    }
  }

  const lowerAffectedPaths = affectedPaths.map((path) => path.toLowerCase());
  if (lowerAffectedPaths.some(includesMutatingNameHint)) {
    return "mutating";
  }

  const trimmedCommand = command?.trim();
  if (!trimmedCommand) {
    return "unknown";
  }
  if (isReadOnlyShellCommand(trimmedCommand)) {
    return "read_only";
  }

  const namesAndPaths = [actionName, toolName, ...lowerAffectedPaths]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.toLowerCase());
  if (namesAndPaths.some(includesShellNameHint)) {
    return "mutating";
  }

  return MUTATING_SHELL_PATTERNS.some((pattern) => pattern.test(trimmedCommand.toLowerCase()))
    ? "mutating"
    : "unknown";
};
