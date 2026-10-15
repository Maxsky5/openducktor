import { basename, join } from "node:path";
import { Effect } from "effect";
import { formatTerminalPathInput } from "../../application/terminals/terminal-path-input";
import { TERMINAL_LIMITS } from "../../application/terminals/terminal-limits";
import { TerminalPtyError, type TerminalPtyLaunchPlan } from "../../ports/terminal-pty-port";
import { writeTerminalTempFiles } from "./terminal-temp-files";

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
    if (shell === "bash" && !supportsBashHooks(plan)) return { plan, dispose: Effect.void };
    if (shell === "fish")
      return {
        plan: { ...plan, args: [...plan.args, "--init-command", fishHooks(nonce)] },
        dispose: Effect.void,
      };
    const { root, dispose } = yield* writeTerminalTempFiles(
      "odt-terminal-shell-",
      (root) =>
        shell === "zsh" ? zshFiles(plan, root, nonce) : { bashrc: bashScript(plan, nonce) },
      shellFailure,
    );
    return {
      plan:
        shell === "zsh"
          ? { ...plan, env: { ...plan.env, ZDOTDIR: root } }
          : plan.args.includes("-l")
            ? {
                ...plan,
                args: ["--posix", ...plan.args],
                env: { ...plan.env, ENV: join(root, "bashrc") },
              }
            : { ...plan, args: ["--init-file", join(root, "bashrc"), ...plan.args] },
      dispose,
    };
  });

function zshFiles(plan: TerminalPtyLaunchPlan, root: string, nonce: string) {
  const quote = (value: string) => formatTerminalPathInput(plan.shell, [value]);
  return {
    ".zshenv": [
      plan.env.ZDOTDIR === undefined ? "unset ZDOTDIR" : `ZDOTDIR=${quote(plan.env.ZDOTDIR)}`,
      '[[ ! -r "${ZDOTDIR-$HOME}/.zshenv" ]] || source "${ZDOTDIR-$HOME}/.zshenv"',
      // System profiles use ZDOTDIR for history and key files. Keep the user's directory
      // throughout startup, then append our hooks before the first interactive command.
      'builtin zmodload zsh/sched || { print -u2 -- "OpenDucktor could not load zsh/sched. Install the zsh modules, then reopen the terminal."; exit 1; }',
      `builtin sched +0 ${quote(`source ${quote(join(root, "hooks.zsh"))}`)}`,
    ].join("\n"),
    "hooks.zsh": [
      posixHooks(nonce, true),
      zshHooks(),
      ...(plan.interactiveCommand === undefined
        ? []
        : [
            '[[ -o zle ]] || { print -u2 -- "OpenDucktor Actions need the zsh line editor. Enable ZLE, then run the Action again."; exit 1; }',
          ]),
      zshReady(),
    ].join("\n"),
  };
}

function zshHooks(): string {
  return (
    [
      ["preexec", "_odt_command_start"],
      ["precmd", "_odt_command_end"],
    ] as const
  )
    .flatMap(([hook, handler]) => {
      const failure = `{ builtin print -u2 -- "OpenDucktor could not install zsh command hooks. Fix the ${hook} function in your zsh startup files, then reopen the terminal."; exit 1; }`;
      return [
        `builtin typeset -ga ${hook}_functions`,
        `if (( $+functions[${hook}] )); then`,
        `  if [[ \${functions[${hook}]} == 'builtin autoload -X'* ]]; then`,
        `    builtin autoload +X ${hook} || ${failure}`,
        "  fi",
        `  functions[_odt_user_${hook}]=$functions[${hook}] || ${failure}`,
        `  ${hook}_functions=(_odt_user_${hook} "\${${hook}_functions[@]}")`,
        "fi",
        `functions[${hook}]=$functions[${handler}] || ${failure}`,
      ];
    })
    .join("\n");
}

function zshReady(): string {
  const failure =
    '{ builtin print -u2 -- "OpenDucktor could not install zsh line-editor hooks. Check zle-line-init in your zsh startup files, then reopen the terminal."; exit 1; }';
  return [
    "if [[ -o zle ]]; then",
    "  if builtin zle -l zle-line-init; then",
    `    builtin zle -A zle-line-init _odt_user_line_init || ${failure}`,
    "  fi",
    "  _odt_line_init() {",
    "    local code=0 ready=1",
    "    {",
    "      if builtin zle -l _odt_user_line_init; then",
    '        builtin zle _odt_user_line_init -- "$@"',
    "        code=$?",
    "      fi",
    "    } always {",
    "      if [[ $CONTEXT == start ]]; then",
    "        if [[ -n $BUFFER ]] || (( KEYS_QUEUED_COUNT || PENDING )); then ready=0; fi",
    String.raw`        builtin printf '\033]633;R;%s;%s\007' "$_odt_nonce" "$ready"`,
    "      fi",
    "    }",
    '    return "$code"',
    "  }",
    `  builtin zle -N zle-line-init _odt_line_init || ${failure}`,
    "fi",
  ].join("\n");
}

function supportsBashHooks(plan: TerminalPtyLaunchPlan): boolean {
  // POSIX startup belongs to the user's ENV file.
  if (
    plan.args.includes("--posix") ||
    plan.env.POSIXLY_CORRECT !== undefined ||
    plan.env.SHELLOPTS?.split(":").includes("posix")
  )
    return false;
  // Apple's Bash ignores the ENV hook. Keep its real login mode and startup files.
  return !(
    process.platform === "darwin" &&
    ["/bin/bash", "/usr/bin/bash"].includes(plan.shell) &&
    plan.args.includes("-l")
  );
}

function bashScript(plan: TerminalPtyLaunchPlan, nonce: string): string {
  const options = plan.env.BASHOPTS?.split(":") ?? [];
  // GNU Bash reads ENV in POSIX mode. Restore normal mode before the user's profiles run.
  const startup = plan.args.includes("-l")
    ? [
        "set +o posix",
        ...(options.includes("shift_verbose") ? [] : ["shopt -u shift_verbose"]),
        ...(options.includes("inherit_errexit")
          ? []
          : [
              "if (( BASH_VERSINFO[0] > 4 || BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4 )); then shopt -u inherit_errexit; fi",
            ]),
        plan.env.ENV === undefined
          ? "unset ENV"
          : `export ENV=${formatTerminalPathInput(plan.shell, [plan.env.ENV])}`,
        "[[ ! -r /etc/profile ]] || builtin source /etc/profile",
        'for _odt_profile in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do',
        '  if [[ -r "$_odt_profile" ]]; then builtin source "$_odt_profile"; break; fi',
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

function posixHooks(nonce: string, zsh = false): string {
  return [
    `_odt_nonce=${formatTerminalPathInput("/bin/bash", [nonce])}`,
    "_odt_command_start() {",
    "  local LC_ALL=C",
    `  local line="\${1:0:${TERMINAL_LIMITS.commandMarkerBytes}}" char code index restart=0`,
    ...(zsh
      ? [
          `  (( \${#1} <= ${TERMINAL_LIMITS.commandMarkerBytes} )) && [[ -o zle ]] && restart=1`,
          '  local word name input="${3-$1}"',
          "  if (( restart )); then",
          '    for word in "${(@z)input}"; do',
          "      word=${(Q)word}",
          "      name=${word%%=*}",
          "      [[ $word == *=* && $name == [A-Za-z_]* && $name != *[^A-Za-z0-9_]* ]] && continue",
          '      case "$word" in',
          "        builtin|command|noglob|nocorrect|time|!) continue;;",
          "        exec|exit|logout) restart=0;;",
          "      esac",
          "      break",
          "    done",
          "  fi",
        ]
      : []),
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
    String.raw`  builtin printf ';%s;%s\007\033]633;C\007' "$_odt_nonce" "$restart"`,
    "}",
    "_odt_command_end() {",
    "  local code=$?",
    String.raw`  builtin printf '\033]633;D;%s;%s\007' "$code" "$_odt_nonce"`,
    "}",
  ].join("\n");
}

function fishHooks(nonce: string): string {
  return [
    "function _odt_command_start --on-event fish_preexec",
    `  set -l line (string sub --length ${TERMINAL_LIMITS.activityCommandLength} -- "$argv[1]")`,
    '  set line (string escape --style=url -- "$line")',
    String.raw`  set line (string replace --all '%' '\x' -- "$line")`,
    String.raw`  printf '\033]633;E;%s;%s\007\033]633;C\007' "$line" ${formatTerminalPathInput("fish", [nonce])}`,
    "end",
    "function _odt_command_end --on-event fish_postexec",
    String.raw`  printf '\033]633;D;%s;%s\007' $status ${formatTerminalPathInput("fish", [nonce])}`,
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
