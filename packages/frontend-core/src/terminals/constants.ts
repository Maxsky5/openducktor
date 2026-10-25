export const TERMINAL_RECOVERY_TIMEOUT_MS = 10_000;

export const HTTP_URL = /https?:\/\/[^\s<>"'`|]+/giu;
export const URL_END_MARKS = new Set([".", ","]);
export const URL_BARE_END_MARKS = new Set([";", ":", "!", "?"]);
export const URL_BRACKETS = new Map([
  [")", "("],
  ["]", "["],
  ["}", "{"],
]);
