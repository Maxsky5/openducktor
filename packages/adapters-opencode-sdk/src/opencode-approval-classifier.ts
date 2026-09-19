import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import {
  type AgentApprovalMutation,
  isOdtWorkflowMutationToolName,
  normalizeOdtWorkflowToolName,
} from "@openducktor/core";

const wordSet = (values: string): ReadonlySet<string> => new Set(values.split(" "));

const SHELL_PERMISSION_NAMES = wordSet("bash shell");
const MUTATING_PERMISSION_NAMES = wordSet("edit write patch apply_patch");
const READ_ONLY_PERMISSION_NAMES = wordSet("read glob grep list webfetch websearch lsp skill");

const READ_ONLY_COMMANDS = wordSet("cat echo grep head ls pwd readlink stat tail test wc");
const MUTATING_COMMANDS = wordSet(
  "bash chmod chown cp mkdir mv nc ncat netcat rm rmdir sh tee touch truncate zsh",
);

const READ_ONLY_GIT_SUBCOMMANDS = wordSet("diff log show status");
const MUTATING_GIT_SUBCOMMANDS = wordSet(
  "add checkout clean commit merge pull push rebase reset stash switch",
);
const READ_ONLY_GIT_OPTIONS = wordSet(
  "-b -p -s -u -z --branch --cached --decorate --graph --name-only --name-status --no-patch --oneline --patch --porcelain --raw --short --staged --stat --summary",
);
const READ_ONLY_GIT_OPTION_PREFIXES = [
  "--column=",
  "--decorate=",
  "--format=",
  "--max-count=",
  "--pretty=",
  "--porcelain=",
  "--untracked-files=",
];

const MUTATING_FIND_OPTIONS = wordSet(
  "-delete -exec -execdir -fls -fprint -fprint0 -fprintf -ok -okdir",
);
const READ_ONLY_FIND_OPTIONS = wordSet(
  "-- -H -L -P -a -and -empty -group -iname -maxdepth -mindepth -mtime -name -newer -not -o -or -path -perm -print -print0 -prune -size -type -user",
);

const MUTATING_CURL_OPTIONS = wordSet(
  "-F -O -T -d -o --data --data-ascii --data-binary --data-raw --data-urlencode --form --json --output --remote-name --upload-file",
);
const MUTATING_HTTP_METHODS = wordSet("DELETE PATCH POST PUT");

type TokenizationResult =
  | { kind: "tokens"; tokens: [string, ...string[]] }
  | { kind: "mutating_syntax" }
  | { kind: "unknown_syntax" };

const tokenizeNativeCommandPattern = (pattern: string): TokenizationResult => {
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let hasUnknownSyntax = false;

  const pushToken = (): void => {
    if (token.length > 0) {
      tokens.push(token);
      token = "";
    }
  };

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern.charAt(index);
    if (escaped) {
      token += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = null;
        continue;
      }
      if (
        quote === '"' &&
        (character === "`" || (character === "$" && pattern[index + 1] === "("))
      ) {
        hasUnknownSyntax = true;
      }
      token += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      pushToken();
      continue;
    }
    if (character === ">") {
      if (pattern[index + 1] === "&") {
        hasUnknownSyntax = true;
        continue;
      }
      return { kind: "mutating_syntax" };
    }
    if (
      character === "`" ||
      character === "<" ||
      character === "|" ||
      character === ";" ||
      character === "(" ||
      character === ")" ||
      (character === "$" && pattern[index + 1] === "(")
    ) {
      hasUnknownSyntax = true;
      continue;
    }
    if (character === "&") {
      if (pattern[index + 1] === ">") {
        return { kind: "mutating_syntax" };
      }
      hasUnknownSyntax = true;
      continue;
    }
    token += character;
  }

  if (escaped || quote) {
    return { kind: "unknown_syntax" };
  }
  pushToken();
  if (hasUnknownSyntax) {
    return { kind: "unknown_syntax" };
  }
  const command = tokens[0];
  return command
    ? { kind: "tokens", tokens: [command, ...tokens.slice(1)] }
    : { kind: "unknown_syntax" };
};

const classifyGitCommand = (tokens: readonly string[]): AgentApprovalMutation => {
  const subcommand = tokens[1]?.toLowerCase();
  if (!subcommand) {
    return "unknown";
  }
  if (MUTATING_GIT_SUBCOMMANDS.has(subcommand)) {
    return "mutating";
  }
  if (!READ_ONLY_GIT_SUBCOMMANDS.has(subcommand)) {
    return "unknown";
  }

  const options = tokens.slice(2).filter((token) => token.startsWith("-"));
  if (options.some((option) => option === "--output" || option.startsWith("--output="))) {
    return "mutating";
  }

  for (const option of options) {
    if (/^-\d+$/.test(option)) {
      continue;
    }
    if (
      !READ_ONLY_GIT_OPTIONS.has(option) &&
      !READ_ONLY_GIT_OPTION_PREFIXES.some((prefix) => option.startsWith(prefix))
    ) {
      return "unknown";
    }
  }
  return "read_only";
};

const classifyFindCommand = (tokens: readonly string[]): AgentApprovalMutation => {
  let hasUnknownOption = false;
  for (const token of tokens.slice(1)) {
    if (MUTATING_FIND_OPTIONS.has(token)) {
      return "mutating";
    }
    if (token.startsWith("-") && !READ_ONLY_FIND_OPTIONS.has(token)) {
      hasUnknownOption = true;
    }
  }
  return hasUnknownOption ? "unknown" : "read_only";
};

const classifyCurlCommand = (tokens: readonly string[]): AgentApprovalMutation => {
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) {
      continue;
    }
    if (token === "--request" || token === "-X") {
      const method = tokens[index + 1]?.toUpperCase();
      if (method && MUTATING_HTTP_METHODS.has(method)) {
        return "mutating";
      }
      index += 1;
      continue;
    }
    if (token.startsWith("--request=")) {
      const method = token.slice("--request=".length).toUpperCase();
      if (MUTATING_HTTP_METHODS.has(method)) {
        return "mutating";
      }
      continue;
    }
    if (MUTATING_CURL_OPTIONS.has(token)) {
      return "mutating";
    }
    if (token.startsWith("-X") && MUTATING_HTTP_METHODS.has(token.slice(2).toUpperCase())) {
      return "mutating";
    }
    if (/^-(?:F|O|T|d|o).+/.test(token)) {
      return "mutating";
    }
    for (const option of MUTATING_CURL_OPTIONS) {
      if (option.startsWith("--") && token.startsWith(`${option}=`)) {
        return "mutating";
      }
    }
  }
  return "unknown";
};

const classifyPrintfCommand = (tokens: readonly string[]): AgentApprovalMutation => {
  const firstArgument = tokens[1];
  if (!firstArgument || firstArgument === "--" || !firstArgument.startsWith("-")) {
    return "read_only";
  }
  return firstArgument === "-v" || /^-v.+/.test(firstArgument) ? "mutating" : "unknown";
};

const classifyNativeCommandPattern = (pattern: string): AgentApprovalMutation => {
  const tokenized = tokenizeNativeCommandPattern(pattern.trim());
  if (tokenized.kind === "mutating_syntax") {
    return "mutating";
  }
  if (tokenized.kind === "unknown_syntax") {
    return "unknown";
  }

  const command = tokenized.tokens[0].toLowerCase();
  if (command.includes("/") || command.includes("\\")) {
    return "unknown";
  }
  if (MUTATING_COMMANDS.has(command)) {
    return "mutating";
  }
  if (READ_ONLY_COMMANDS.has(command)) {
    return "read_only";
  }
  if (command === "git") {
    return classifyGitCommand(tokenized.tokens);
  }
  if (command === "find") {
    return classifyFindCommand(tokenized.tokens);
  }
  if (command === "curl") {
    return classifyCurlCommand(tokenized.tokens);
  }
  if (command === "printf") {
    return classifyPrintfCommand(tokenized.tokens);
  }
  if (command === "rg") {
    return tokenized.tokens
      .slice(1)
      .some((token) =>
        ["--hostname-bin", "--pre", "--pre-glob"].some(
          (option) => token === option || token.startsWith(`${option}=`),
        ),
      )
      ? "unknown"
      : "read_only";
  }
  if (command === "sort") {
    const options = tokenized.tokens.slice(1);
    if (
      options.some(
        (option) =>
          option === "-o" ||
          /^-o.+/.test(option) ||
          option === "--output" ||
          option.startsWith("--output="),
      )
    ) {
      return "mutating";
    }
    return options.some(
      (option) => option === "--compress-program" || option.startsWith("--compress-program="),
    )
      ? "unknown"
      : "read_only";
  }
  return "unknown";
};

const classifyWorkflowToolName = (name: string | undefined): AgentApprovalMutation | null => {
  const trimmedName = name?.trim();
  if (!trimmedName) {
    return null;
  }
  const aliases = OPENCODE_RUNTIME_DESCRIPTOR.workflowToolAliasesByCanonical;
  if (isOdtWorkflowMutationToolName(trimmedName, aliases)) {
    return "mutating";
  }
  return normalizeOdtWorkflowToolName(trimmedName, aliases) ? "read_only" : null;
};

const classifyShellPatterns = (patterns: readonly string[]): AgentApprovalMutation => {
  let result: AgentApprovalMutation = "read_only";
  for (const pattern of patterns) {
    const classification = classifyNativeCommandPattern(pattern);
    if (classification === "mutating") {
      return "mutating";
    }
    if (classification === "unknown") {
      result = "unknown";
    }
  }
  return result;
};

export type OpenCodeApprovalMutationInput = {
  permission: string;
  toolName?: string | undefined;
  patterns: readonly string[];
  command?: string | undefined;
};

export const classifyOpenCodeApprovalMutation = ({
  permission,
  toolName,
  patterns,
  command,
}: OpenCodeApprovalMutationInput): AgentApprovalMutation => {
  const workflowClassifications = [permission, toolName].flatMap((name) => {
    const classification = classifyWorkflowToolName(name);
    return classification ? [classification] : [];
  });
  if (workflowClassifications.includes("mutating")) {
    return "mutating";
  }

  const normalizedNames = [permission, toolName]
    .flatMap((name) => (name === undefined ? [] : [name.trim().toLowerCase()]))
    .filter((name) => name.length > 0);
  if (normalizedNames.some((name) => MUTATING_PERMISSION_NAMES.has(name))) {
    return "mutating";
  }
  if (normalizedNames.some((name) => SHELL_PERMISSION_NAMES.has(name))) {
    const commandClassification = command
      ? classifyNativeCommandPattern(command)
      : ("unknown" as const);
    if (commandClassification === "mutating") {
      return "mutating";
    }
    return patterns.length > 0 ? classifyShellPatterns(patterns) : commandClassification;
  }
  if (workflowClassifications.includes("read_only")) {
    return "read_only";
  }
  if (normalizedNames.some((name) => READ_ONLY_PERMISSION_NAMES.has(name))) {
    return "read_only";
  }
  return "unknown";
};
