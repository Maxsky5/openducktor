import { randomBytes } from "node:crypto";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const SUFFIX_BYTES = 14;
const messageSuffix = (seed: Uint8Array) =>
  Array.from(seed.subarray(0, SUFFIX_BYTES), (byte) => BASE62.charAt(byte % 62)).join("");

let lastTimestamp = 0;
let counter = 0;

/**
 * Creates a native message ID in the format of OpenCode `SessionMessage.ID.create()`: `msg_`, the
 * low six bytes of time and counter in hex, then 14 base62 characters. IDs sort by creation time.
 */
export const createOpenCodeMessageId = (seed: Uint8Array = randomBytes(SUFFIX_BYTES)): string => {
  const timestamp = Date.now();
  counter = timestamp === lastTimestamp ? counter + 1 : 1;
  lastTimestamp = timestamp;
  const time = ((BigInt(timestamp) * 0x1000n + BigInt(counter)) & 0xffff_ffff_ffffn)
    .toString(16)
    .padStart(12, "0");
  return `msg_${time}${messageSuffix(seed)}`;
};

/** Checks the part of a handoff message ID that follows its native time and counter. */
export const matchesOpenCodeMessageId = (messageId: string, seed: Uint8Array): boolean =>
  /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/.test(messageId) &&
  messageId.slice(16) === messageSuffix(seed);
