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

  return segments.length > 0 && segments.every((segment) => isReadOnlyShellSegment(segment));
};
