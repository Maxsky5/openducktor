import { basenameForPath } from "@openducktor/path-support";
// The shells that Codex runs a command script with, as `/bin/zsh -lc "<script>"`.
const SCRIPT_SHELLS = new Set(["bash", "zsh", "sh"]);
const SCRIPT_FLAGS = new Set(["-c", "-lc"]);
// In double quotes, a backslash escapes only these characters.
const DOUBLE_QUOTE_ESCAPES = new Set(["$", "`", '"', "\\", "\n"]);

/**
 * The words of a command line as a POSIX shell splits them, without their quotes. Null when a
 * quote stays open.
 */
const splitShellWords = (command: string): string[] | null => {
  const words: string[] = [];
  let word: string | null = null;
  let index = 0;
  while (index < command.length) {
    const char = command.charAt(index);
    if (char === " " || char === "\t" || char === "\n") {
      if (word !== null) words.push(word);
      word = null;
      index += 1;
    } else if (char === "'") {
      const end = command.indexOf("'", index + 1);
      if (end < 0) return null;
      word = (word ?? "") + command.slice(index + 1, end);
      index = end + 1;
    } else if (char === '"') {
      let text = "";
      index += 1;
      while (index < command.length && command.charAt(index) !== '"') {
        const next = command.charAt(index + 1);
        if (command.charAt(index) === "\\" && DOUBLE_QUOTE_ESCAPES.has(next)) {
          if (next !== "\n") text += next;
          index += 2;
        } else {
          text += command.charAt(index);
          index += 1;
        }
      }
      if (index >= command.length) return null;
      word = (word ?? "") + text;
      index += 1;
    } else if (char === "\\") {
      const next = command.charAt(index + 1);
      word = (word ?? "") + (next === "\n" ? "" : next);
      index += 2;
    } else {
      word = (word ?? "") + char;
      index += 1;
    }
  }
  if (word !== null) words.push(word);
  return words;
};

/**
 * The script of a command that Codex runs through a shell, such as `/bin/zsh -lc "<script>"`, as
 * the agent wrote it. A command that Codex runs without a shell stays as it is.
 */
export const readCodexShellScript = (command: string): string => {
  const words = splitShellWords(command);
  if (words?.length !== 3) return command;
  const [program = "", flag = "", script = ""] = words;
  const shell = basenameForPath(program);
  return SCRIPT_SHELLS.has(shell) && SCRIPT_FLAGS.has(flag) ? script : command;
};
