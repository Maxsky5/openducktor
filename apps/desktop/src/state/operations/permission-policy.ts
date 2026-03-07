const MUTATING_HINTS = [
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

const SHELL_PERMISSION_HINTS = ["bash", "shell", "exec", "command"];

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

const toLower = (value: unknown): string => (typeof value === "string" ? value.toLowerCase() : "");

const hasMutatingHint = (value: string): boolean =>
  MUTATING_HINTS.some((hint) => value.includes(hint));

const isReadOnlyShellSegment = (value: string): boolean => {
  const segment = value.trim();
  if (segment.length === 0) {
    return false;
  }
  return SAFE_READ_SHELL_PATTERNS.some((pattern) => pattern.test(segment));
};

export const isSafeReadToolName = (toolName: string): boolean =>
  SAFE_READ_TOOL_NAMES.has(toolName.trim().toLowerCase());

export const isReadOnlyShellCommand = (command: string): boolean => {
  const normalized = command.trim().toLowerCase();
  if (normalized.length === 0) {
    return false;
  }
  if (MUTATING_SHELL_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  const segments = normalized
    .split(/&&|\|\||;|\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (segments.length === 0) {
    return false;
  }

  return segments.every((segment) => isReadOnlyShellSegment(segment));
};

export const isMutatingPermission = (
  permission: string,
  patterns: string[],
  metadata?: Record<string, unknown>,
): boolean => {
  const permissionLower = permission.trim().toLowerCase();
  if (hasMutatingHint(permissionLower)) {
    return true;
  }

  const metadataTool = toLower(metadata?.tool);
  if (metadataTool.length > 0) {
    if (MUTATING_TOOL_NAMES.has(metadataTool)) {
      return true;
    }
    if (SAFE_READ_TOOL_NAMES.has(metadataTool)) {
      return false;
    }
  }

  const lowerPatterns = patterns.map((pattern) => pattern.toLowerCase());
  if (lowerPatterns.some((pattern) => hasMutatingHint(pattern))) {
    return true;
  }

  const shellPermission =
    SHELL_PERMISSION_HINTS.some((hint) => permissionLower.includes(hint)) ||
    lowerPatterns.some((pattern) => SHELL_PERMISSION_HINTS.some((hint) => pattern.includes(hint)));

  const commandLower = toLower(metadata?.command);
  if (!shellPermission) {
    if (commandLower.length === 0) {
      return false;
    }
    if (isReadOnlyShellCommand(commandLower)) {
      return false;
    }
    return MUTATING_SHELL_PATTERNS.some((pattern) => pattern.test(commandLower));
  }

  if (commandLower.length === 0) {
    // Unknown shell intent: keep human-in-the-loop instead of auto-rejecting.
    return false;
  }
  if (isReadOnlyShellCommand(commandLower)) {
    return false;
  }
  return true;
};
