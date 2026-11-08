// The phone of the sample story: the host that it pairs with, and the sessions of the open
// workspaces on its Sessions tab. The phone lists the sessions of the desktop sidebar, so its rows
// come from NAV_SESSIONS. The Builder of the search shortcut task waits for a permission. The
// Builder session of the task shows the same tool calls and plan in each scene. The times are
// fictional.
import type { RailStep } from "../replicas/mobile/MobileRail";
import type { MobileTool } from "../replicas/mobile/TranscriptRows";
import type { NavEntry } from "../replicas/shell/nav";
import type { RoleId } from "../replicas/vocabulary";
import { NAV_SESSIONS } from "./nav";

/** The address of the host on the local network, as the Network section of Remote control shows it. */
export const HOST_ENDPOINT = "http://192.168.1.24:14328";

/** The label of a host that the app saves without a name: the host name of its address. */
export const HOST_LABEL = "192.168.1.24";

/** The one-time pairing code of Add device. */
export const PAIRING_CODE = "482915";

/** The reference of the paired phone: the first 8 characters of its client ID. */
export const DEVICE_REFERENCE = "7c1e4a9b";

/**
 * The module rows of the pairing QR code that the qrcode package makes from the payload of
 * pairing-panel.tsx: {"type":"openducktor-pairing","version":1,"endpoint":HOST_ENDPOINT,
 * "code":PAIRING_CODE}. A phone can scan it.
 */
export const PAIRING_QR = [
  "11111110110111011110001011000111101111111",
  "10000010001100010010010010101100001000001",
  "10111010101110001000001011000011001011101",
  "10111010110010101101001000011011101011101",
  "10111010111001010110000011011000101011101",
  "10000010100100110101000011011100101000001",
  "11111110101010101010101010101010101111111",
  "00000000010110011110010011000001000000000",
  "00111111010001010110100101011111010111101",
  "01011001100111011001110111010111011100010",
  "11000010010010110101011101010100101110000",
  "01001101010111011110000100110111110011010",
  "00101011010110011010011111111101000100100",
  "01110100101110000011100000011010000111100",
  "10101010110010100010110011010110010111011",
  "00011000001011011010111011001110011010110",
  "11010010000011011100011101000101010001001",
  "00001000100010000111001010101010000000101",
  "11010110000111101001011101111010101010000",
  "10001001110000111000010011000000000001011",
  "11011011011001011010011001001010110001111",
  "00010001011101110111110101110111000010110",
  "11010111111011010001010000001010001010111",
  "00001001110000000100010001011011100101010",
  "10110110101001010111100000011010110010111",
  "00000000100010110111000011001100000000101",
  "00000110110100111110101110100001000101011",
  "10000100001000000011101010111111110110100",
  "10110010010100110110100001110101101000010",
  "01010100110010100011011011101111100000001",
  "10011111011001010001110000000100101101110",
  "00101001010110011111010101010010001111111",
  "00001110000010111111110010000100111111110",
  "00000000011010110101011111111100100011100",
  "11111110110000000101010011001000101010100",
  "10000010100011001110111011010001100011101",
  "10111010111101010110101101110110111110111",
  "10111010101001100001101000011000010110101",
  "10111010111010101100101010101010100011000",
  "10000010011011011101000110001111110010110",
  "11111110010111010101110111011101110011000",
] as const;

/** The Builder of the search shortcut task asks for a permission. */
export const WAITING_BUILD = "shortcut-build";

/**
 * The sessions of every open workspace on the Sessions tab, in the order of their groups: the
 * Builder that waits for a permission, two running sessions, and four recent sessions.
 */
export const PHONE_SESSIONS: readonly NavEntry[] = [
  { ...NAV_SESSIONS[WAITING_BUILD], attention: "Permission", unread: true },
  NAV_SESSIONS["focus-qa"],
  NAV_SESSIONS["sync-build"],
  NAV_SESSIONS["titles-spec"],
  NAV_SESSIONS["typing-qa"],
  NAV_SESSIONS["tags-chat"],
  NAV_SESSIONS["theme-plan"],
];

/** The tool calls of the Builder session of the search shortcut task, in order. */
export const BUILDER_TOOLS = {
  guide: { type: "read", name: "read", summary: "AGENTS.md", duration: "1ms", time: "9:46:35 AM" },
  keymap: {
    type: "read",
    name: "read",
    summary: "src/app/keymap.ts",
    duration: "1ms",
    time: "9:46:38 AM",
  },
  list: { type: "list", name: "list", summary: "src/search", duration: "1ms", time: "9:46:41 AM" },
  search: {
    type: "bash",
    name: "bash",
    summary: "rg -n keydown src",
    duration: "88ms",
    time: "9:46:43 AM",
  },
  shell: {
    type: "read",
    name: "read",
    summary: "src/app/app-shell.tsx",
    duration: "1ms",
    time: "9:46:45 AM",
  },
  dialog: {
    type: "read",
    name: "read",
    summary: "src/search/search-dialog.tsx",
    duration: "1ms",
    time: "9:46:46 AM",
  },
  lint: {
    type: "bash",
    name: "bash",
    summary: "bun run lint",
    duration: "3.8s",
    time: "9:48:20 AM",
  },
  test: {
    type: "bash",
    name: "bash",
    summary: "bun test src/search",
    duration: "2.4s",
    time: "9:48:51 AM",
  },
  typecheck: {
    type: "bash",
    name: "bash",
    summary: "bun run typecheck",
    duration: "4.1s",
    time: "9:49:00 AM",
  },
} as const satisfies Record<string, MobileTool>;

/** The plan of the Builder after it reads the code. */
export const BUILDER_PLAN =
  "I add the hook in `src/search/use-search-shortcut.ts`, and the app shell mounts it once.";

/** The workflow rail while the Builder works. */
export const BUILDER_RAIL = {
  spec: { tone: "done", mark: "done" },
  planner: { tone: "done", mark: "done" },
  build: { tone: "in_progress", mark: "working" },
  qa: { tone: "blocked", mark: "none" },
} as const satisfies Record<RoleId, RailStep>;
