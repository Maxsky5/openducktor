export const LINK_POINTER_CLASS = "odt-terminal-link-pointer";
export const LINKS_ENABLED_CLASS = "odt-terminal-links";
export const LINK_DRAG_PX = 4;

export const HTTP_URL = /https?:\/\/[^\s<>"'`|]+/giu;
export const URL_END_MARKS = new Set([".", ","]);
export const URL_BARE_END_MARKS = new Set([";", ":", "!", "?"]);
export const URL_BRACKETS = new Map([
  [")", "("],
  ["]", "["],
  ["}", "{"],
]);
