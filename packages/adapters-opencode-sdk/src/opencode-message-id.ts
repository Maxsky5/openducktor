const OPENCODE_ID_RANDOM_LENGTH = 14;
const OPENCODE_ID_COUNTER_LIMIT = 0x1000;
const BASE62_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

let lastTimestamp = 0;
let counter = 0;

const getCrypto = (): Crypto => {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new Error("OpenCode message IDs require globalThis.crypto.getRandomValues().");
  }
  return cryptoApi;
};

const randomBase62 = (length: number): string => {
  const bytes = new Uint8Array(length);
  getCrypto().getRandomValues(bytes);
  let result = "";
  for (let index = 0; index < length; index += 1) {
    result += BASE62_CHARS[(bytes[index] ?? 0) % BASE62_CHARS.length];
  }
  return result;
};

const toSixByteHex = (value: bigint): string => {
  const bytes = new Uint8Array(6);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number((value >> BigInt(40 - 8 * index)) & BigInt(0xff));
  }

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const createOpenCodeMessageId = (timestamp = Date.now()): string => {
  if (timestamp !== lastTimestamp) {
    lastTimestamp = timestamp;
    counter = 0;
  }

  counter += 1;
  if (counter >= OPENCODE_ID_COUNTER_LIMIT) {
    throw new Error("OpenCode message ID counter exhausted for this second.");
  }

  const encodedTime = BigInt(timestamp) * BigInt(OPENCODE_ID_COUNTER_LIMIT) + BigInt(counter);

  return `msg_${toSixByteHex(encodedTime)}${randomBase62(OPENCODE_ID_RANDOM_LENGTH)}`;
};
