import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { GitPort } from "../../ports/git-port";
import {
  combineOptionalOutput,
  combineOutput,
  type GitCommandError,
  type GitCommandRunner,
  runGitAllowFailure,
} from "./git-command-runner";

/** The fetch method of the Git port. */
export const createGitRemoteFetchMethods = (
  runner: GitCommandRunner,
  readEnv: () => NodeJS.ProcessEnv,
): Pick<GitPort, "fetchRemote"> => ({
  fetchRemote: (repoPath, remote) => fetchRemote(runner, readEnv(), repoPath, remote),
});

/**
 * Fetches every branch of one remote and prunes the branches that the remote deleted. Git and SSH
 * never ask for input, so a fetch that needs credentials or a host key confirmation fails. The
 * fetch keeps FETCH_HEAD, which belongs to the user of the checkout. Returns the Git output.
 */
export const fetchRemote = (
  runner: GitCommandRunner,
  env: NodeJS.ProcessEnv,
  repoPath: string,
  remote: string,
): Effect.Effect<string, GitCommandError> =>
  Effect.gen(function* () {
    const sshCommand = yield* readNoPromptSshCommand(runner, env, repoPath);
    const result = yield* runner(
      repoPath,
      ["fetch", "--prune", "--no-write-fetch-head", "--end-of-options", remote],
      {
        allowFailure: true,
        env: {
          // An empty value makes Git skip every askpass program, also one that a terminal sets.
          GIT_ASKPASS: "",
          GCM_INTERACTIVE: "never",
          GIT_SSH_COMMAND: sshCommand,
        },
      },
    );
    if (!result.ok) {
      return yield* new HostOperationError({
        operation: "git.fetch",
        message: `git fetch ${remote} failed: ${combineOutput(result.stdout, result.stderr)}`,
        details: { repoPath, remote },
      });
    }
    return combineOptionalOutput(result.stdout, result.stderr) || `Fetched ${remote}`;
  });

/**
 * The SSH command that Git would use, with the option that stops its prompts. Git picks the
 * command and the program variant as `connect.c` does: `GIT_SSH_COMMAND`, `core.sshCommand`, then
 * `GIT_SSH`, and `GIT_SSH_VARIANT`, `ssh.variant`, then the program name.
 */
const readNoPromptSshCommand = (
  runner: GitCommandRunner,
  env: NodeJS.ProcessEnv,
  repoPath: string,
): Effect.Effect<string, GitCommandError> =>
  Effect.gen(function* () {
    const envCommand = env.GIT_SSH_COMMAND?.trim();
    const envVariant = env.GIT_SSH_VARIANT?.trim();
    const config =
      envCommand && envVariant ? new Map<string, string>() : yield* readSshConfig(runner, repoPath);
    const command = envCommand || config.get("core.sshcommand");
    const gitSsh = env.GIT_SSH?.trim();
    const variantName = envVariant || config.get("ssh.variant");
    const variant = variantName
      ? (NAMED_SSH_VARIANTS.get(variantName) ?? "ssh")
      : programSshVariant(command ? firstShellWord(command) : (gitSsh ?? "ssh"));
    const batchOption = SSH_BATCH_OPTIONS[variant];
    const sshCommand = command ?? (gitSsh ? quoteShellWord(gitSsh) : "ssh");
    return batchOption ? `${sshCommand} ${batchOption}` : sshCommand;
  });

type SshVariant = "auto" | "simple" | "ssh" | "plink" | "putty" | "tortoiseplink";

/** The option that stops the prompts of each variant. */
const SSH_BATCH_OPTIONS = {
  ssh: "-o BatchMode=yes",
  // Git cannot tell this program from ssh before it runs, and most wrappers run ssh.
  auto: "-o BatchMode=yes",
  plink: "-batch",
  putty: "-batch",
  // Git adds `-batch` itself.
  tortoiseplink: null,
  // This program takes no options.
  simple: null,
} satisfies Record<SshVariant, string | null>;

/** Reads `core.sshCommand` and `ssh.variant` in one Git call, by their lowercase keys. */
const readSshConfig = (
  runner: GitCommandRunner,
  repoPath: string,
): Effect.Effect<Map<string, string>, GitCommandError> =>
  runGitAllowFailure(runner, repoPath, [
    "config",
    "--get-regexp",
    "^(core\\.sshcommand|ssh\\.variant)$",
  ]).pipe(
    Effect.map((result) => {
      const values = new Map<string, string>();
      if (!result.ok) return values;
      for (const line of result.stdout.split("\n")) {
        const separator = line.indexOf(" ");
        const value = separator < 0 ? "" : line.slice(separator + 1).trim();
        if (value) values.set(line.slice(0, separator).toLowerCase(), value);
      }
      return values;
    }),
  );

/** The variant names that Git knows. Git maps any other name to `ssh`. */
const NAMED_SSH_VARIANTS = new Map<string, SshVariant>([
  ["auto", "auto"],
  ["simple", "simple"],
  ["plink", "plink"],
  ["putty", "putty"],
  ["tortoiseplink", "tortoiseplink"],
]);

const programSshVariant = (program: string): SshVariant => {
  const name = program
    .split(/[\\/]/)
    .at(-1)
    ?.toLowerCase()
    .replace(/\.exe$/, "");
  if (name === "ssh" || name === "plink" || name === "tortoiseplink") return name;
  return "auto";
};

/** The first word of a shell command, without its quotes. */
const firstShellWord = (command: string): string => {
  const quote = command[0];
  if (quote === "'" || quote === '"') {
    const end = command.indexOf(quote, 1);
    return end < 0 ? command.slice(1) : command.slice(1, end);
  }
  return command.split(/\s/, 1)[0] ?? command;
};

const quoteShellWord = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;
