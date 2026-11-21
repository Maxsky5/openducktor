import type { WorkspaceProcessListener } from "@openducktor/contracts";
import { basenameForPath } from "@openducktor/path-support";
import type { LiveProcess } from "../../ports/process-inspector-port";

const POSIX_SHELLS = new Set(["bash", "zsh", "sh", "dash", "ksh", "mksh", "fish", "tcsh", "csh"]);
const POWERSHELLS = new Set(["pwsh", "powershell"]);
const POWERSHELL_COMMAND_OPTIONS = new Set([
  "-c",
  "-command",
  "-f",
  "-file",
  "-e",
  "-ec",
  "-encodedcommand",
]);

/** The executable name without its directory, `.exe` suffix, or login-shell dash. */
const programName = (process: Pick<LiveProcess, "name" | "executable">): string => {
  return basenameForPath(process.executable ?? process.name)
    .replace(/^-/, "")
    .replace(/\.exe$/i, "")
    .toLowerCase();
};

/** Shell options whose next argument is a value, such as the terminal integration files. */
const POSIX_VALUE_OPTIONS = new Set([
  "--init-file",
  "--rcfile",
  "--init-command",
  "-C",
  "-o",
  "-O",
]);

/**
 * The name that `ps` shows: the first argument without its directory. Some executables, such as
 * Claude Code, have a version as their file name.
 */
export const processDisplayName = (process: LiveProcess): string =>
  basenameForPath(process.arguments?.[0] ?? "").replace(/^-/, "") ||
  process.name ||
  `Process ${process.pid}`;

/** The name of the app that runs a process: its macOS app bundle, else its program name. */
export const appName = (process: LiveProcess): string =>
  /\/([^/]+)\.app\//.exec(process.executable ?? "")?.[1] ??
  processDisplayName(process).replace(/\.exe$/i, "");

/**
 * The command line of a process for display. The program shows by its name, and an argument
 * with a space gets quotes.
 */
export const processCommandLine = (process: LiveProcess): string => {
  const [program, ...rest] = process.arguments ?? [];
  if (program === undefined) return processDisplayName(process);
  const quoted = rest.map((argument) => (/\s/.test(argument) ? `"${argument}"` : argument));
  return [processDisplayName(process), ...quoted].join(" ");
};

const runsPosixCommand = (options: readonly string[]): boolean => {
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option === undefined) break;
    if (POSIX_VALUE_OPTIONS.has(option)) {
      index += 1;
      continue;
    }
    if (!option.startsWith("-") || option === "--command") return true;
    if (/^-[a-zA-Z]+$/.test(option) && option.includes("c")) return true;
  }
  return false;
};

/**
 * Programs that run the commands of an agent: shells, and the sandbox wrappers of Codex
 * (`sandbox-exec` on macOS, `codex-linux-sandbox` on Linux, `codex-command-runner` on Windows).
 */
const COMMAND_CARRIERS = new Set([
  ...POSIX_SHELLS,
  ...POWERSHELLS,
  "nu",
  "cmd",
  "sandbox-exec",
  "codex-linux-sandbox",
  "codex-command-runner",
]);

/**
 * True for a child of an agent runtime that runs a command of the agent. Any other child, such as
 * an MCP server or a language server, is a tool of the runtime.
 */
export const runsAgentCommand = (process: LiveProcess): boolean =>
  COMMAND_CARRIERS.has(programName(process));

/**
 * True for an agent runtime that serves another app: `opencode serve`, such as the one that
 * OpenDucktor starts or the background service of OpenCode, `codex app-server`, and Claude Code
 * with `--input-format stream-json`. Claude Code can have a version as its file name, so its first
 * argument names it.
 */
export const isAgentRuntimeServer = (process: LiveProcess): boolean => {
  const program = programName(process);
  const args = process.arguments ?? [];
  const [, command] = args;
  const inputFormat = args.indexOf("--input-format");
  return (
    (program === "opencode" && command === "serve") ||
    (program === "codex" && command === "app-server") ||
    (basenameForPath(args[0] ?? "") === "claude" &&
      inputFormat !== -1 &&
      args[inputFormat + 1] === "stream-json")
  );
};

/**
 * True for a shell that waits for input. A shell that runs a command, a script, or `-c` stays
 * visible, because it is the project command. Unknown arguments count as a command.
 */
export const isIdleInteractiveShell = (process: LiveProcess): boolean => {
  const program = programName(process);
  const options = process.arguments?.slice(1);
  if (options === undefined) return false;
  if (POSIX_SHELLS.has(program) || program === "nu") return !runsPosixCommand(options);
  if (POWERSHELLS.has(program))
    return !options.some(
      (option) => !option.startsWith("-") || POWERSHELL_COMMAND_OPTIONS.has(option.toLowerCase()),
    );
  if (program === "cmd") return !options.some((option) => /^\/[ck]$/i.test(option));
  return false;
};

/**
 * Ports that the Fetch standard blocks, so a browser refuses to open them.
 * See https://fetch.spec.whatwg.org/#port-blocking.
 */
const BROWSER_BLOCKED_PORTS = new Set([
  0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102,
  103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465,
  512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993,
  995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668,
  6669, 6679, 6697, 10080,
]);

type ListenerProtocol = "http" | "https" | "non_web" | "unknown";

/** The shortest prefix that argparse accepts for `--tls-cert` among the `http.server` options. */
const TLS_CERT_PREFIX = "--tls-c";

/**
 * True when the `http.server` arguments set `--tls-cert`, as `--tls-cert PATH`,
 * `--tls-cert=PATH`, or an abbreviation that argparse accepts. `--` ends the options.
 */
const setsTlsCertificate = (serverArguments: readonly string[]): boolean => {
  for (const argument of serverArguments) {
    if (argument === "--") return false;
    const option = argument.split("=")[0] ?? "";
    if (option.length >= TLS_CERT_PREFIX.length && "--tls-cert".startsWith(option)) return true;
  }
  return false;
};

/**
 * Reads the protocol from documented server evidence. Python `http.server` serves HTTPS when it
 * gets `--tls-cert`. A PostgreSQL server speaks its own wire protocol.
 */
const listenerProtocol = (process: LiveProcess): ListenerProtocol => {
  const program = programName(process);
  if (program === "postgres") return "non_web";
  const args = process.arguments ?? [];
  const module = args.indexOf("-m");
  if (/^python(\d+(\.\d+)?)?$/.test(program) && module !== -1 && args[module + 1] === "http.server")
    return setsTlsCertificate(args.slice(module + 2)) ? "https" : "http";
  return "unknown";
};

const browserHost = (address: string): string => {
  if (address === "0.0.0.0") return "127.0.0.1";
  if (address === "::") return "[::1]";
  return address.includes(":") ? `[${address}]` : address;
};

/** Describes how the browser can reach one listener of a process. */
export const browserTarget = (
  process: LiveProcess,
  listener: { address: string; port: number },
): WorkspaceProcessListener["browser"] => {
  const protocol = listenerProtocol(process);
  if (protocol === "non_web") return { kind: "non_web" };
  if (BROWSER_BLOCKED_PORTS.has(listener.port))
    return {
      kind: "unavailable",
      issue: {
        message: `Browsers block port ${listener.port}.`,
        nextAction: "Use a client for this protocol, or serve the app on another port.",
      },
    };
  const scheme = protocol === "https" ? "https" : "http";
  const url = URL.parse(`${scheme}://${browserHost(listener.address)}:${listener.port}/`);
  if (url === null)
    return {
      kind: "unavailable",
      issue: {
        message: `Address ${listener.address} does not form a browser URL.`,
        nextAction: "Open the server at a loopback address.",
      },
    };
  return { kind: "link", url: url.href, suggested: protocol === "unknown" };
};

/** The opaque reference of one process instance. */
export const encodeProcessRef = (process: { pid: number; identity: string }): string =>
  `${process.pid}:${process.identity}`;

export const decodeProcessRef = (value: string): { pid: number; identity: string } | null => {
  const [, pidText, identity] = /^(\d+):(\d+)$/.exec(value) ?? [];
  if (pidText === undefined || identity === undefined) return null;
  const pid = Number(pidText);
  return Number.isSafeInteger(pid) && pid > 0 ? { pid, identity } : null;
};
