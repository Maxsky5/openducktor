import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import {
  type AgentApprovalMutation,
  isOdtWorkflowMutationToolName,
  normalizeOdtWorkflowToolName,
} from "@openducktor/core";

const words = (value: string): ReadonlySet<string> => new Set(value.split(" "));

const SHELL_PERMISSIONS = words("bash shell");
const MUTATING_PERMISSIONS = words("edit write patch apply_patch");
const READ_ONLY_PERMISSIONS = words("read glob grep list webfetch websearch lsp skill");

const MUTATING_COMMANDS = words(
  "chmod chown cp mkdir mv nc ncat netcat rm rmdir tee touch truncate",
);
const READ_ONLY_COMMANDS = words("cat echo grep head ls pwd readlink stat tail test wc");
const SHELL_COMMANDS = words("bash sh zsh");
const SHELL_NON_EXECUTING_OPTIONS = words(
  "--dump-po-strings --dump-strings --help --no-exec --no_exec --noexec --version",
);

const READ_ONLY_GIT_SUBCOMMANDS = words("diff log show status");
const MUTATING_GIT_SUBCOMMANDS = words(
  "add checkout clean commit merge pull push rebase reset restore rm stash switch",
);
const READ_ONLY_GIT_OPTIONS = words(
  "-b -p -s -u -z --all --branch --cached --decorate --graph --name-only --name-status --no-patch --oneline --patch --porcelain --raw --short --staged --stat --summary",
);
const READ_ONLY_GIT_OPTIONS_WITH_VALUE = words("-n --max-count");
const READ_ONLY_GIT_OPTION_PREFIXES = [
  "--decorate=",
  "--format=",
  "--max-count=",
  "--pretty=",
  "--porcelain=",
  "--untracked-files=",
];

const MUTATING_FIND_ACTIONS = words(
  "-delete -exec -execdir -fls -fprint -fprint0 -fprintf -ok -okdir",
);
const READ_ONLY_FIND_OPTIONS = words(
  "-- -H -L -P -a -and -depth -empty -not -o -or -print -print0 -prune",
);
const READ_ONLY_FIND_OPTIONS_WITH_VALUE = words(
  "-group -iname -maxdepth -mindepth -mtime -name -newer -path -perm -regex -regextype -size -type -user",
);

const READ_ONLY_SORT_OPTIONS = words(
  "-b -d -f -g -h -i -M -m -n -R -r -s -u -V -z --check --dictionary-order --general-numeric-sort --human-numeric-sort --ignore-case --ignore-leading-blanks --merge --month-sort --numeric-sort --random-sort --reverse --stable --unique --version-sort --zero-terminated",
);
const READ_ONLY_SORT_OPTIONS_WITH_VALUE = words(
  "-k -S -t -T --batch-size --buffer-size --field-separator --files0-from --key --parallel --random-source --sort --temporary-directory",
);
const UNKNOWN_SORT_OPTIONS_WITH_VALUE = words("--compress-program");

const MUTATING_CURL_OPTIONS = words(
  "-F -O -T -d --data --data-ascii --data-binary --data-raw --data-urlencode --form --form-string --json --remote-name --remote-name-all --upload-file",
);
const CURL_FILE_OUTPUT_OPTIONS = words(
  "-D -c -o --cookie-jar --dump-header --etag-save --libcurl --output --trace --trace-ascii",
);
const CURL_OPTIONS_WITH_VALUE = words("-H -K --config --header");
const MUTATING_HTTP_METHODS = words("DELETE PATCH POST PUT");

type SimpleCommand = [string, ...string[]];

const UNSUPPORTED_SHELL_SYNTAX = "|&;<>`$(){}*?[]#\n\r";

type SimpleCommandScan = {
  tokens: SimpleCommand;
  outputRedirect: boolean;
};

const hasAttachedLongOption = (option: string, names: ReadonlySet<string>): boolean => {
  for (const name of names) {
    if (name.startsWith("--") && option.startsWith(`${name}=`)) {
      return true;
    }
  }
  return false;
};

const readAttachedShortOptionValue = (
  option: string,
  names: ReadonlySet<string>,
): string | null => {
  for (const name of names) {
    if (/^-[^-]$/.test(name) && option.startsWith(name) && option.length > name.length) {
      return option.slice(name.length);
    }
  }
  return null;
};

const readSimpleCommand = (value: string): SimpleCommandScan | null => {
  const tokens: string[] = [];
  let token = "";
  let tokenStarted = false;
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let readingRedirectTarget = false;
  let outputRedirect = false;

  const pushToken = (): void => {
    if (!tokenStarted) {
      return;
    }
    if (!readingRedirectTarget) {
      tokens.push(token);
    }
    token = "";
    tokenStarted = false;
    readingRedirectTarget = false;
  };

  const input = value.trim();
  for (let index = 0; index < input.length; index += 1) {
    const character = input.charAt(index);
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
      } else if (quote === '"' && (character === "$" || character === "`")) {
        return null;
      } else {
        token += character;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      tokenStarted = true;
      continue;
    }
    if (character === ">") {
      if (readingRedirectTarget && !tokenStarted) {
        return null;
      }
      pushToken();
      if (input[index + 1] === ">" || input[index + 1] === "|") {
        index += 1;
      }
      readingRedirectTarget = true;
      outputRedirect = true;
      continue;
    }
    if (character === "<") {
      if (
        (readingRedirectTarget && !tokenStarted) ||
        input[index + 1] === "<" ||
        input[index + 1] === "(" ||
        input[index + 1] === "&" ||
        input[index + 1] === ">"
      ) {
        return null;
      }
      pushToken();
      readingRedirectTarget = true;
      continue;
    }
    if (UNSUPPORTED_SHELL_SYNTAX.includes(character)) {
      return null;
    }
    if (/\s/.test(character)) {
      pushToken();
      continue;
    }
    token += character;
    tokenStarted = true;
  }

  if (escaped || quote || (readingRedirectTarget && !tokenStarted)) {
    return null;
  }
  pushToken();
  const command = tokens[0];
  return command ? { tokens: [command, ...tokens.slice(1)], outputRedirect } : null;
};

const classifyGit = (tokens: SimpleCommand): AgentApprovalMutation => {
  let subcommandIndex = 1;
  while (tokens[subcommandIndex] === "-C") {
    if (!tokens[subcommandIndex + 1]) {
      return "unknown";
    }
    subcommandIndex += 2;
  }

  const subcommand = tokens[subcommandIndex];
  if (!subcommand || subcommand.startsWith("-")) {
    return "unknown";
  }
  if (subcommand === "stash" && tokens[subcommandIndex + 1] === "list") {
    return "unknown";
  }
  if (
    subcommand === "clean" &&
    tokens
      .slice(subcommandIndex + 1)
      .some((option) => option === "--dry-run" || /^-[^-]*n/.test(option))
  ) {
    return "unknown";
  }
  if (MUTATING_GIT_SUBCOMMANDS.has(subcommand)) {
    return "mutating";
  }
  if (!READ_ONLY_GIT_SUBCOMMANDS.has(subcommand)) {
    return "unknown";
  }

  for (let index = subcommandIndex + 1; index < tokens.length; index += 1) {
    const option = tokens[index];
    if (option === "--") {
      break;
    }
    if (!option?.startsWith("-")) {
      continue;
    }
    if (option === "--output" || option.startsWith("--output=")) {
      return "mutating";
    }
    if (READ_ONLY_GIT_OPTIONS_WITH_VALUE.has(option)) {
      index += 1;
      continue;
    }
    if (
      !READ_ONLY_GIT_OPTIONS.has(option) &&
      !READ_ONLY_GIT_OPTION_PREFIXES.some((prefix) => option.startsWith(prefix)) &&
      !/^-\d+$/.test(option)
    ) {
      return "unknown";
    }
  }
  return "read_only";
};

const classifyFind = (tokens: SimpleCommand): AgentApprovalMutation => {
  for (let index = 1; index < tokens.length; index += 1) {
    const option = tokens[index];
    if (option === "--") {
      return "unknown";
    }
    if (option && MUTATING_FIND_ACTIONS.has(option)) {
      return "mutating";
    }
    if (option && READ_ONLY_FIND_OPTIONS_WITH_VALUE.has(option)) {
      index += 1;
      continue;
    }
    if (option && /^-O[0-3]$/.test(option)) {
      continue;
    }
    if (option?.startsWith("-") && !READ_ONLY_FIND_OPTIONS.has(option)) {
      return "unknown";
    }
  }
  return "read_only";
};

const classifySort = (tokens: SimpleCommand): AgentApprovalMutation => {
  let hasUnknownOption = false;
  for (let index = 1; index < tokens.length; index += 1) {
    const option = tokens[index];
    if (option === "--") {
      break;
    }
    if (
      option === "-o" ||
      option === "--output" ||
      /^-o.+/.test(option ?? "") ||
      option?.startsWith("--output=")
    ) {
      return "mutating";
    }
    if (option && READ_ONLY_SORT_OPTIONS_WITH_VALUE.has(option)) {
      index += 1;
      continue;
    }
    if (
      option &&
      readAttachedShortOptionValue(option, READ_ONLY_SORT_OPTIONS_WITH_VALUE) !== null
    ) {
      continue;
    }
    if (option && UNKNOWN_SORT_OPTIONS_WITH_VALUE.has(option)) {
      hasUnknownOption = true;
      index += 1;
      continue;
    }
    if (option && hasAttachedLongOption(option, UNKNOWN_SORT_OPTIONS_WITH_VALUE)) {
      hasUnknownOption = true;
      continue;
    }
    if (option?.startsWith("-") && !READ_ONLY_SORT_OPTIONS.has(option) && !/^-\d+$/.test(option)) {
      return "unknown";
    }
  }
  return hasUnknownOption ? "unknown" : "read_only";
};

const classifyCurl = (tokens: SimpleCommand): AgentApprovalMutation => {
  for (let index = 1; index < tokens.length; index += 1) {
    const option = tokens[index];
    if (!option || option === "--") {
      break;
    }
    if (CURL_OPTIONS_WITH_VALUE.has(option)) {
      index += 1;
      continue;
    }
    if (option === "-X" || option === "--request") {
      if (MUTATING_HTTP_METHODS.has(tokens[index + 1]?.toUpperCase() ?? "")) {
        return "mutating";
      }
      index += 1;
      continue;
    }
    if (option.startsWith("-X") || option.startsWith("--request=")) {
      const method = option.replace(/^-X|^--request=/, "").toUpperCase();
      if (MUTATING_HTTP_METHODS.has(method)) {
        return "mutating";
      }
      continue;
    }
    if (CURL_FILE_OUTPUT_OPTIONS.has(option)) {
      const output = tokens[index + 1];
      if (!output || output === "-") {
        return "unknown";
      }
      return "mutating";
    }
    const attachedFileOutput = readAttachedShortOptionValue(option, CURL_FILE_OUTPUT_OPTIONS);
    if (attachedFileOutput !== null) {
      return attachedFileOutput === "-" ? "unknown" : "mutating";
    }
    if (hasAttachedLongOption(option, CURL_FILE_OUTPUT_OPTIONS)) {
      if (option.endsWith("=-") || option === "--trace=%") {
        return "unknown";
      }
      return "mutating";
    }
    if (MUTATING_CURL_OPTIONS.has(option)) {
      return "mutating";
    }
    if (hasAttachedLongOption(option, MUTATING_CURL_OPTIONS)) {
      return "mutating";
    }
    if (/^-[^-]*[FOTd]/.test(option)) {
      return "mutating";
    }
  }
  return "unknown";
};

const hasNonExecutingShellMode = (tokens: SimpleCommand): boolean => {
  for (let index = 1; index < tokens.length; index += 1) {
    const option = tokens[index];
    if (!option?.startsWith("-") || option === "-") {
      return false;
    }
    if (
      SHELL_NON_EXECUTING_OPTIONS.has(option) ||
      (/^-[^-]+/.test(option) && /[Dn]/.test(option.slice(1)))
    ) {
      return true;
    }
    if (option === "-o" && tokens[index + 1]?.replace(/[-_]/g, "").toLowerCase() === "noexec") {
      return true;
    }
    if (option === "-c") {
      return false;
    }
  }
  return false;
};

const classifySimpleCommand = (tokens: SimpleCommand): AgentApprovalMutation => {
  const command = tokens[0];
  if (command.includes("/") || command.includes("\\")) {
    return "unknown";
  }
  if (SHELL_COMMANDS.has(command)) {
    return hasNonExecutingShellMode(tokens) ? "unknown" : "mutating";
  }
  if (MUTATING_COMMANDS.has(command)) {
    if (
      command === "rm" &&
      tokens.length === 2 &&
      (tokens[1] === "--help" || tokens[1] === "--version")
    ) {
      return "unknown";
    }
    return "mutating";
  }
  if (READ_ONLY_COMMANDS.has(command)) {
    return "read_only";
  }
  if (command === "git") {
    return classifyGit(tokens);
  }
  if (command === "find") {
    return classifyFind(tokens);
  }
  if (command === "sort") {
    return classifySort(tokens);
  }
  if (command === "sed") {
    return tokens
      .slice(1)
      .some(
        (option) =>
          option.startsWith("-i") || option === "--in-place" || option.startsWith("--in-place="),
      )
      ? "mutating"
      : "unknown";
  }
  if (command === "perl") {
    return tokens
      .slice(1)
      .some((option) => option.startsWith("-i") || option === "-pi" || option.startsWith("-pi."))
      ? "mutating"
      : "unknown";
  }
  if (command === "curl") {
    return classifyCurl(tokens);
  }
  if (command === "dd") {
    return tokens.slice(1).some((operand) => /^of=.+/.test(operand)) ? "mutating" : "unknown";
  }
  if (command === "printf") {
    return tokens[1] === "-v" ? "mutating" : "read_only";
  }
  if (command === "rg") {
    return tokens.some((token) => /^(--hostname-bin|--pre|--pre-glob)(=|$)/.test(token))
      ? "unknown"
      : "read_only";
  }
  return "unknown";
};

const classifyNativeCommand = (pattern: string): AgentApprovalMutation => {
  const command = readSimpleCommand(pattern);
  if (!command) {
    return "unknown";
  }
  return command.outputRedirect ? "mutating" : classifySimpleCommand(command.tokens);
};

const classifyWorkflowTool = (name: string | undefined): AgentApprovalMutation | null => {
  const toolName = name?.trim();
  if (!toolName) {
    return null;
  }
  const aliases = OPENCODE_RUNTIME_DESCRIPTOR.workflowToolAliasesByCanonical;
  if (isOdtWorkflowMutationToolName(toolName, aliases)) {
    return "mutating";
  }
  return normalizeOdtWorkflowToolName(toolName, aliases) ? "read_only" : null;
};

const classifyAll = (patterns: readonly string[]): AgentApprovalMutation => {
  let result: AgentApprovalMutation = "read_only";
  for (const pattern of patterns) {
    const classification = classifyNativeCommand(pattern);
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
  const names = toolName === undefined ? [permission] : [permission, toolName];
  const workflowClassifications = names.map(classifyWorkflowTool);
  if (workflowClassifications.includes("mutating")) {
    return "mutating";
  }

  const normalizedNames = names.map((name) => name.trim().toLowerCase()).filter(Boolean);
  if (normalizedNames.some((name) => MUTATING_PERMISSIONS.has(name))) {
    return "mutating";
  }
  if (normalizedNames.some((name) => SHELL_PERMISSIONS.has(name))) {
    if (patterns.length > 0) {
      return classifyAll(patterns);
    }
    return command ? classifyNativeCommand(command) : "unknown";
  }
  if (workflowClassifications.includes("read_only")) {
    return "read_only";
  }
  if (normalizedNames.some((name) => READ_ONLY_PERMISSIONS.has(name))) {
    return "read_only";
  }
  return "unknown";
};
