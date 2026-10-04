import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Effect } from "effect";
import { formatTerminalPathInput } from "../../application/terminals/terminal-path-input";
import { TerminalPtyError, type TerminalPtyLaunchPlan } from "../../ports/terminal-pty-port";

export type TerminalShell = {
  plan: TerminalPtyLaunchPlan;
  dispose: Effect.Effect<void, TerminalPtyError>;
};

/** Install per-terminal hooks without changing the user's shell files or reading shell history. */
export const prepareTerminalShell = (
  plan: TerminalPtyLaunchPlan,
): Effect.Effect<TerminalShell, TerminalPtyError> =>
  Effect.gen(function* () {
    const shell = basename(plan.shell).toLowerCase();
    const nonce = plan.commandNonce;
    if (!nonce || !["bash", "zsh", "fish"].includes(shell)) return { plan, dispose: Effect.void };
    if (shell === "fish")
      return {
        plan: { ...plan, args: [...plan.args, "--init-command", fishHooks(nonce)] },
        dispose: Effect.void,
      };
    const root = yield* Effect.tryPromise({
      try: () => mkdtemp(join(tmpdir(), "odt-terminal-shell-")),
      catch: (cause) => shellFailure(cause, "start"),
    });
    const dispose = Effect.tryPromise({
      try: () => rm(root, { recursive: true, force: true }),
      catch: (cause) => shellFailure(cause, "terminate"),
    });
    const files =
      shell === "zsh" ? zshFiles(plan, root, nonce) : { bashrc: bashScript(plan, nonce) };
    yield* Effect.tryPromise({
      try: () =>
        Promise.all(Object.entries(files).map(([name, text]) => writeFile(join(root, name), text))),
      catch: (cause) => shellFailure(cause, "start"),
    }).pipe(Effect.tapError(() => dispose));
    return {
      plan:
        shell === "zsh"
          ? { ...plan, env: { ...plan.env, ZDOTDIR: root } }
          : { ...plan, args: ["--init-file", join(root, "bashrc"), "-i"] },
      dispose,
    };
  });

function zshFiles(plan: TerminalPtyLaunchPlan, root: string, nonce: string) {
  const quote = (value: string) => formatTerminalPathInput(plan.shell, [value]);
  const restore = 'if (( _odt_zdotdir_set )); then ZDOTDIR="$_odt_zdotdir"; else unset ZDOTDIR; fi';
  const save = '_odt_zdotdir="${ZDOTDIR-$HOME}"\n_odt_zdotdir_set=${+ZDOTDIR}';
  const redirect = `ZDOTDIR=${quote(root)}`;
  const source = (name: string) =>
    `[[ ! -r "\${ZDOTDIR-$HOME}/${name}" ]] || source "\${ZDOTDIR-$HOME}/${name}"`;
  return {
    ".zshenv": [
      plan.env.ZDOTDIR === undefined ? "unset ZDOTDIR" : `ZDOTDIR=${quote(plan.env.ZDOTDIR)}`,
      source(".zshenv"),
      save,
      redirect,
    ].join("\n"),
    ".zprofile": [restore, source(".zprofile"), save, redirect].join("\n"),
    ".zshrc": [
      restore,
      source(".zshrc"),
      posixHooks(nonce),
      "preexec_functions+=(_odt_command_start)",
      "precmd_functions+=(_odt_command_end)",
      save,
      `[[ ! -o login ]] || ${redirect}`,
    ].join("\n"),
    ".zlogin": [restore, source(".zlogin"), "unset _odt_zdotdir _odt_zdotdir_set"].join("\n"),
  };
}

function bashScript(plan: TerminalPtyLaunchPlan, nonce: string): string {
  // Bash ignores --init-file with -l. Read the same profiles and retain login-shell exit behavior.
  const startup = plan.args.includes("-l")
    ? [
        "shopt -s login_shell",
        "[[ ! -r /etc/profile ]] || source /etc/profile",
        'for _odt_profile in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do',
        '  if [[ -r "$_odt_profile" ]]; then source "$_odt_profile"; break; fi',
        "done",
        "unset _odt_profile",
      ]
    : ['[[ ! -r "$HOME/.bashrc" ]] || source "$HOME/.bashrc"'];
  return [
    ...startup,
    posixHooks(nonce),
    "if declare -F __bp_preexec_invoke_exec >/dev/null; then",
    "  preexec_functions+=(_odt_command_start)",
    "  precmd_functions+=(_odt_command_end)",
    "else",
    "  _odt_executing=0",
    '  _odt_user_prompt=("${PROMPT_COMMAND[@]}")',
    "  _odt_before_command() {",
    "    local code=$?",
    '    case "$BASH_COMMAND" in _odt_prompt*) _odt_executing=0;;',
    '      *) [[ $_odt_executing != 1 ]] || _odt_command_start "$BASH_COMMAND";; esac',
    '    return "$code"',
    "  }",
    '  _odt_status() { return "$1"; }',
    "  _odt_prompt() {",
    "    local code=$? prompt",
    "    _odt_executing=0",
    "    _odt_command_end",
    '    for prompt in "${_odt_user_prompt[@]}"; do',
    '      _odt_status "$code"',
    '      eval "$prompt"',
    "      code=$?",
    "    done",
    "    _odt_executing=1",
    '    return "$code"',
    "  }",
    "  PROMPT_COMMAND=_odt_prompt",
    // trap -p prints quoted shell words. Read those words without splitting the user's trap body.
    '  eval "_odt_debug=( $(trap -p DEBUG) )"',
    "  if [[ -n ${_odt_debug[2]} ]]; then",
    '    trap "_odt_before_command; ${_odt_debug[2]}" DEBUG',
    "  else",
    "    trap '_odt_before_command; :' DEBUG",
    "  fi",
    "  unset _odt_debug",
    "fi",
  ].join("\n");
}

function posixHooks(nonce: string): string {
  return [
    `_odt_nonce=${formatTerminalPathInput("/bin/bash", [nonce])}`,
    "_odt_command_start() {",
    '  local line="${1:0:1024}" char code index',
    "  local LC_ALL=C",
    String.raw`  builtin printf '\033]633;E;'`,
    "  for (( index=0; index<${#line}; index++ )); do",
    '    char="${line:$index:1}"',
    String.raw`    builtin printf -v code '%d' "'$char"`,
    // Bash 3.2 can read UTF-8 bytes as negative character codes.
    "    code=$(( code & 255 ))",
    "    if (( code <= 32 || code == 59 || code == 92 || code == 127 )); then",
    String.raw`      builtin printf '\\x%02x' "$code"`,
    "    else",
    String.raw`      builtin printf '%s' "$char"`,
    "    fi",
    "  done",
    String.raw`  builtin printf ';%s\007\033]633;C\007' "$_odt_nonce"`,
    "}",
    String.raw`_odt_command_end() { builtin printf '\033]633;D\007'; }`,
  ].join("\n");
}

function fishHooks(nonce: string): string {
  return [
    "function _odt_command_start --on-event fish_preexec",
    '  set -l line (string sub --length 1024 -- "$argv[1]")',
    '  set line (string escape --style=url -- "$line")',
    String.raw`  set line (string replace --all '%' '\x' -- "$line")`,
    String.raw`  printf '\033]633;E;%s;%s\007\033]633;C\007' "$line" ${formatTerminalPathInput("fish", [nonce])}`,
    "end",
    "function _odt_command_end --on-event fish_postexec",
    String.raw`  printf '\033]633;D\007'`,
    "end",
  ].join("\n");
}

function shellFailure(cause: unknown, operation: "start" | "terminate"): TerminalPtyError {
  return new TerminalPtyError({
    code: operation === "start" ? "spawn_failed" : "operation_failed",
    operation,
    message: `Could not ${operation === "start" ? "prepare" : "remove"} terminal command hooks. Check access to the temporary directory and retry.`,
    cause,
  });
}
