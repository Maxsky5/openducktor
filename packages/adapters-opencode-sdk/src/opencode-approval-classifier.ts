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
  "-b -p -s -u -z --all --branch --cached --decorate --graph --name-only --name-status --no-patch --oneline --patch --porcelain --raw --short --staged --stat --summary",
);
const READ_ONLY_GIT_OPTIONS_WITH_ARGUMENT = wordSet("-n --max-count");
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
const READ_ONLY_FIND_OPTIONS_WITH_ARGUMENT = wordSet(
  "-group -iname -maxdepth -mindepth -mtime -name -newer -path -perm -size -type -user",
);

const MUTATING_CURL_OPTIONS = wordSet(
  "-F -O -T -d -o --data --data-ascii --data-binary --data-raw --data-urlencode --form --json --output --remote-name --upload-file",
);
const MUTATING_HTTP_METHODS = wordSet("DELETE PATCH POST PUT");

const READ_ONLY_SORT_OPTIONS = wordSet(
  "-b -d -f -g -h -i -M -m -n -R -r -s -u -V -z --check --dictionary-order --general-numeric-sort --human-numeric-sort --ignore-case --ignore-leading-blanks --merge --month-sort --numeric-sort --random-sort --reverse --stable --unique --version-sort --zero-terminated",
);
const READ_ONLY_SORT_OPTIONS_WITH_ARGUMENT = wordSet(
  "-k -S -t -T --batch-size --buffer-size --field-separator --files0-from --key --parallel --random-source --sort --temporary-directory",
);

type TokenizationResult =
  | { kind: "tokens"; tokens: [string, ...string[]]; hasUnknownSyntax: boolean }
  | { kind: "mutating_syntax" }
  | { kind: "unknown_syntax" };

const hasProvenAlternateOutputFileTarget = (
  pattern: string,
  redirectIndex: number,
  currentToken: string,
): boolean => {
  if (/^\d+$/.test(currentToken)) {
    return false;
  }

  let targetIndex = redirectIndex + 2;
  while (pattern[targetIndex] === " " || pattern[targetIndex] === "\t") {
    targetIndex += 1;
  }
  if (!pattern[targetIndex] || pattern[targetIndex] === "#") {
    return false;
  }

  let target = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (let index = targetIndex; index < pattern.length; index += 1) {
    const character = pattern.charAt(index);
    if (escaped) {
      target += character;
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
      if (quote === '"' && (character === "$" || character === "`")) {
        return false;
      }
      target += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/\s/.test(character) || "|&;<>".includes(character)) {
      break;
    }
    if ("$`*?[]{}()".includes(character)) {
      return false;
    }
    target += character;
  }
  return !escaped && !quote && target !== "" && target !== "-" && !/^\d+$/.test(target);
};

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
      if (quote === '"' && (character === "`" || character === "$")) {
        hasUnknownSyntax = true;
      }
      token += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "\n" || character === "\r") {
      pushToken();
      hasUnknownSyntax = true;
      continue;
    }
    if (character === " " || character === "\t") {
      pushToken();
      continue;
    }
    if (character === "#" && (token.length === 0 || "|&;()<>".includes(pattern[index - 1] ?? ""))) {
      hasUnknownSyntax = true;
      break;
    }
    if (character === ">") {
      if (pattern[index + 1] === "&") {
        if (hasProvenAlternateOutputFileTarget(pattern, index, token)) {
          return { kind: "mutating_syntax" };
        }
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
      character === "$" ||
      character === "{" ||
      character === "}" ||
      character === "*" ||
      character === "?" ||
      character === "[" ||
      character === "]"
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
    hasUnknownSyntax = true;
  }
  pushToken();
  const command = tokens[0];
  return command
    ? { kind: "tokens", tokens: [command, ...tokens.slice(1)], hasUnknownSyntax }
    : { kind: "unknown_syntax" };
};

const classifyGitCommand = (tokens: readonly string[]): AgentApprovalMutation => {
  const subcommand = tokens[1];
  if (!subcommand) {
    return "unknown";
  }
  if (MUTATING_GIT_SUBCOMMANDS.has(subcommand)) {
    return "mutating";
  }
  if (!READ_ONLY_GIT_SUBCOMMANDS.has(subcommand)) {
    return "unknown";
  }

  for (let index = 2; index < tokens.length; index += 1) {
    const option = tokens[index];
    if (!option || option === "--") {
      break;
    }
    if (!option.startsWith("-")) {
      continue;
    }
    if (option === "--output" || option.startsWith("--output=")) {
      return "mutating";
    }
    if (READ_ONLY_GIT_OPTIONS_WITH_ARGUMENT.has(option)) {
      index += 1;
      continue;
    }
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
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token || token === "--") {
      break;
    }
    if (MUTATING_FIND_OPTIONS.has(token)) {
      return "mutating";
    }
    if (READ_ONLY_FIND_OPTIONS_WITH_ARGUMENT.has(token)) {
      index += 1;
      continue;
    }
    if (token.startsWith("-") && !READ_ONLY_FIND_OPTIONS.has(token)) {
      return "unknown";
    }
  }
  return "read_only";
};

const classifyCurlCommand = (tokens: readonly string[]): AgentApprovalMutation => {
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) {
      continue;
    }
    if (token === "--") {
      break;
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
    if (token.startsWith("-")) {
      return "unknown";
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

const classifyCommandTokens = (tokens: readonly string[]): AgentApprovalMutation => {
  const command = tokens[0];
  if (!command) {
    return "unknown";
  }
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
    return classifyGitCommand(tokens);
  }
  if (command === "find") {
    return classifyFindCommand(tokens);
  }
  if (command === "curl") {
    return classifyCurlCommand(tokens);
  }
  if (command === "printf") {
    return classifyPrintfCommand(tokens);
  }
  if (command === "rg") {
    for (const option of tokens.slice(1)) {
      if (option === "--") {
        break;
      }
      if (
        ["--hostname-bin", "--pre", "--pre-glob"].some(
          (unsafeOption) => option === unsafeOption || option.startsWith(`${unsafeOption}=`),
        )
      ) {
        return "unknown";
      }
    }
    return "read_only";
  }
  if (command === "sort") {
    let hasUnknownOption = false;
    for (let index = 1; index < tokens.length; index += 1) {
      const option = tokens[index];
      if (!option || option === "--") {
        break;
      }
      if (!option.startsWith("-")) {
        continue;
      }
      if (
        option === "-o" ||
        /^-o.+/.test(option) ||
        option === "--output" ||
        option.startsWith("--output=")
      ) {
        return "mutating";
      }
      if (option === "--compress-program") {
        hasUnknownOption = true;
        index += 1;
        continue;
      }
      if (option.startsWith("--compress-program=")) {
        hasUnknownOption = true;
        continue;
      }
      if (READ_ONLY_SORT_OPTIONS_WITH_ARGUMENT.has(option)) {
        index += 1;
        continue;
      }
      if (
        !READ_ONLY_SORT_OPTIONS.has(option) &&
        !option.startsWith("--check=") &&
        !/^-\d+$/.test(option)
      ) {
        return "unknown";
      }
    }
    return hasUnknownOption ? "unknown" : "read_only";
  }
  return "unknown";
};

const classifyNativeCommandPattern = (pattern: string): AgentApprovalMutation => {
  const tokenized = tokenizeNativeCommandPattern(pattern.replace(/^[ \t]+|[ \t]+$/g, ""));
  if (tokenized.kind === "mutating_syntax") {
    return "mutating";
  }
  if (tokenized.kind === "unknown_syntax") {
    return "unknown";
  }

  const classification = classifyCommandTokens(tokenized.tokens);
  return classification === "mutating" || !tokenized.hasUnknownSyntax ? classification : "unknown";
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
    if (patterns.length > 0) {
      return classifyShellPatterns(patterns);
    }
    return command ? classifyNativeCommandPattern(command) : "unknown";
  }
  if (workflowClassifications.includes("read_only")) {
    return "read_only";
  }
  if (normalizedNames.some((name) => READ_ONLY_PERMISSION_NAMES.has(name))) {
    return "read_only";
  }
  return "unknown";
};
