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
const UNKNOWN_GIT_OPTIONS_WITH_ARGUMENT = wordSet("--since");
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
const UNKNOWN_FIND_OPTIONS_WITH_ARGUMENT = wordSet("-regex -regextype");

const MUTATING_CURL_OPTIONS = wordSet(
  "-F -O -T -d --data --data-ascii --data-binary --data-raw --data-urlencode --form --json --remote-name --upload-file",
);
const MUTATING_HTTP_METHODS = wordSet("DELETE PATCH POST PUT");
const MUTATING_CURL_SHORT_OPTIONS = wordSet("F O T d");
const CURL_FILE_OUTPUT_SHORT_OPTIONS = wordSet("D c o");
const CURL_FILE_OUTPUT_LONG_OPTIONS = wordSet("--cookie-jar --dump-header --output --trace");
const CURL_SHORT_OPTIONS_WITH_ARGUMENT = wordSet("H K");
const CURL_SHORT_OPTIONS_WITHOUT_ARGUMENT = wordSet(
  "# 0 1 2 3 4 6 : B G I J L M N R S V Z a f g i j k l n p q s v",
);
const CURL_LONG_OPTIONS_WITH_ARGUMENT = wordSet("--config --header");
const CURL_LONG_OPTIONS_WITHOUT_ARGUMENT = wordSet("--show-error --silent");

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

const hasOutputProcessSubstitutionTarget = (pattern: string, redirectIndex: number): boolean => {
  let targetIndex = redirectIndex + 1;
  if (pattern[targetIndex] === "(") {
    return true;
  }
  if (pattern[targetIndex] === ">" || pattern[targetIndex] === "|") {
    targetIndex += 1;
  }
  while (pattern[targetIndex] === " " || pattern[targetIndex] === "\t") {
    targetIndex += 1;
  }
  return pattern[targetIndex] === ">" && pattern[targetIndex + 1] === "(";
};

const tokenizeNativeCommandPattern = (pattern: string): TokenizationResult => {
  const tokens: string[] = [];
  let token = "";
  let tokenStarted = false;
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let hasUnknownSyntax = false;

  const pushToken = (): void => {
    if (tokenStarted) {
      tokens.push(token);
      token = "";
      tokenStarted = false;
    }
  };

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern.charAt(index);
    if (escaped) {
      token += character;
      tokenStarted = true;
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
      tokenStarted = true;
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
    if (character === "#" && (!tokenStarted || "|&;()<>".includes(pattern[index - 1] ?? ""))) {
      hasUnknownSyntax = true;
      break;
    }
    if (
      (character === "[" && pattern[index + 1] === "[") ||
      (character === "(" && pattern[index + 1] === "(") ||
      (character === "<" && pattern[index + 1] === "<")
    ) {
      return { kind: "unknown_syntax" };
    }
    if (character === ">") {
      if (hasOutputProcessSubstitutionTarget(pattern, index)) {
        hasUnknownSyntax = true;
        continue;
      }
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
        if (hasOutputProcessSubstitutionTarget(pattern, index + 1)) {
          hasUnknownSyntax = true;
          continue;
        }
        return { kind: "mutating_syntax" };
      }
      hasUnknownSyntax = true;
      continue;
    }
    token += character;
    tokenStarted = true;
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
  if (subcommand === "stash" && tokens[2] === "list") {
    return "unknown";
  }
  if (subcommand === "clean") {
    for (let index = 2; index < tokens.length; index += 1) {
      const option = tokens[index];
      if (!option) {
        break;
      }
      if (option === "--" || !option.startsWith("-")) {
        break;
      }
      if (option === "--dry-run") {
        return "unknown";
      }
      if (option === "--exclude") {
        index += 1;
        continue;
      }
      if (option.startsWith("--")) {
        continue;
      }
      const shortOptions = option.slice(1);
      for (let optionIndex = 0; optionIndex < shortOptions.length; optionIndex += 1) {
        const shortOption = shortOptions.charAt(optionIndex);
        if (shortOption === "n") {
          return "unknown";
        }
        if (shortOption === "e") {
          if (optionIndex === shortOptions.length - 1) {
            index += 1;
          }
          break;
        }
      }
    }
  }
  if (MUTATING_GIT_SUBCOMMANDS.has(subcommand)) {
    return "mutating";
  }
  if (!READ_ONLY_GIT_SUBCOMMANDS.has(subcommand)) {
    return "unknown";
  }

  let hasUnknownOption = false;
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
    if (UNKNOWN_GIT_OPTIONS_WITH_ARGUMENT.has(option)) {
      hasUnknownOption = true;
      index += 1;
      continue;
    }
    if (option.startsWith("--since=")) {
      hasUnknownOption = true;
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
  return hasUnknownOption ? "unknown" : "read_only";
};

const classifyFindCommand = (tokens: readonly string[]): AgentApprovalMutation => {
  let hasUnknownOption = false;
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
    if (UNKNOWN_FIND_OPTIONS_WITH_ARGUMENT.has(token)) {
      hasUnknownOption = true;
      index += 1;
      continue;
    }
    if (token.startsWith("-") && !READ_ONLY_FIND_OPTIONS.has(token)) {
      return "unknown";
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
    const fileOutputOption = [...CURL_FILE_OUTPUT_LONG_OPTIONS].find(
      (option) => token === option || token.startsWith(`${option}=`),
    );
    if (fileOutputOption) {
      const attachedTarget = token.startsWith(`${fileOutputOption}=`)
        ? token.slice(fileOutputOption.length + 1)
        : undefined;
      const target = attachedTarget ?? tokens[index + 1];
      if (!target) {
        return "unknown";
      }
      if (target !== "-" && !(fileOutputOption === "--trace" && target === "%")) {
        return "mutating";
      }
      if (attachedTarget === undefined) {
        index += 1;
      }
      continue;
    }
    if (CURL_LONG_OPTIONS_WITH_ARGUMENT.has(token)) {
      index += 1;
      continue;
    }
    if (
      CURL_LONG_OPTIONS_WITHOUT_ARGUMENT.has(token) ||
      [...CURL_LONG_OPTIONS_WITH_ARGUMENT].some((option) => token.startsWith(`${option}=`))
    ) {
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
    for (const option of MUTATING_CURL_OPTIONS) {
      if (option.startsWith("--") && token.startsWith(`${option}=`)) {
        return "mutating";
      }
    }
    if (token.startsWith("--")) {
      return "unknown";
    }
    if (!token.startsWith("-") || token === "-") {
      continue;
    }

    const shortOptions = token.slice(1);
    for (let optionIndex = 0; optionIndex < shortOptions.length; optionIndex += 1) {
      const option = shortOptions.charAt(optionIndex);
      if (MUTATING_CURL_SHORT_OPTIONS.has(option)) {
        return "mutating";
      }
      if (CURL_FILE_OUTPUT_SHORT_OPTIONS.has(option)) {
        const attachedTarget = shortOptions.slice(optionIndex + 1);
        const target = attachedTarget || tokens[index + 1];
        if (!target) {
          return "unknown";
        }
        if (target !== "-") {
          return "mutating";
        }
        if (!attachedTarget) {
          index += 1;
        }
        break;
      }
      if (option === "X") {
        const attachedMethod = shortOptions.slice(optionIndex + 1);
        const method = (attachedMethod || tokens[index + 1] || "").toUpperCase();
        if (MUTATING_HTTP_METHODS.has(method)) {
          return "mutating";
        }
        if (!attachedMethod) {
          index += 1;
        }
        break;
      }
      if (CURL_SHORT_OPTIONS_WITH_ARGUMENT.has(option)) {
        if (optionIndex === shortOptions.length - 1) {
          index += 1;
        }
        break;
      }
      if (!CURL_SHORT_OPTIONS_WITHOUT_ARGUMENT.has(option)) {
        return "unknown";
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

const hasActiveShellNoExecOption = (tokens: readonly string[]): boolean => {
  let noExec = false;
  let interactive = false;
  for (let index = 1; index < tokens.length; index += 1) {
    const option = tokens[index];
    if (
      !option ||
      option === "-" ||
      option === "--" ||
      (!option.startsWith("-") && !option.startsWith("+"))
    ) {
      break;
    }
    if (option === "--init-file" || option === "--rcfile") {
      index += 1;
      continue;
    }
    if (option.startsWith("--")) {
      continue;
    }

    const enabled = option.startsWith("-");
    const shortOptions = option.slice(1);
    if (shortOptions === "o") {
      if (tokens[index + 1] === "noexec") {
        noExec = enabled;
      }
      index += 1;
      continue;
    }
    if (shortOptions === "O") {
      index += 1;
      continue;
    }
    if (shortOptions.includes("n")) {
      noExec = enabled;
    }
    if (shortOptions.includes("i")) {
      interactive = enabled;
    }
    if (shortOptions.includes("c")) {
      break;
    }
  }
  return noExec && !interactive;
};

const classifyCommandTokens = (tokens: readonly string[]): AgentApprovalMutation => {
  const command = tokens[0];
  if (!command) {
    return "unknown";
  }
  if (command.includes("/") || command.includes("\\")) {
    return "unknown";
  }
  if ((command === "bash" || command === "sh") && hasActiveShellNoExecOption(tokens)) {
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
        if (option === "--debug") {
          hasUnknownOption = true;
          continue;
        }
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
