import { randomBytes } from "node:crypto";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

let lastTimestamp = 0;
let counter = 0;

/**
 * Creates a native message ID in the format of OpenCode `SessionMessage.ID.create()`: `msg_`, the
 * low six bytes of time and counter in hex, then 14 random base62 characters. IDs sort by creation
 * time.
 */
export const createOpenCodeMessageId = (): string => {
  const timestamp = Date.now();
  counter = timestamp === lastTimestamp ? counter + 1 : 1;
  lastTimestamp = timestamp;
  const time = ((BigInt(timestamp) * 0x1000n + BigInt(counter)) & 0xffff_ffff_ffffn)
    .toString(16)
    .padStart(12, "0");
  const random = Array.from(randomBytes(14), (byte) => BASE62.charAt(byte % 62)).join("");
  return `msg_${time}${random}`;
};
