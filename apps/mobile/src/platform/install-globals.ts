import * as ExpoCrypto from "expo-crypto";
import { arrayToSorted } from "./array-to-sorted";
import { GraphemeSegmenter } from "./grapheme-segmenter";
import { Utf8TextDecoder } from "./utf8-text-decoder";

/**
 * Supplies and checks the globals that `packages/frontend-core/src/platform/platform-globals.d.ts`
 * lists, and the newer language built-ins that shared code calls. React Native and the Expo
 * runtime supply most of them. Startup stops with the name of a global that stays missing, so a
 * runtime upgrade cannot remove one without notice.
 */
type GlobalCheck = readonly [name: string, present: () => boolean];

const decoderMeetsContract = (): boolean => {
  if (!("TextDecoder" in globalThis)) return false;
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    // "€" split across two chunks must wait for its last byte.
    const first = decoder.decode(new Uint8Array([0xe2, 0x82]), { stream: true });
    const second = decoder.decode(new Uint8Array([0xac]));
    if (first !== "" || second !== "€") return false;
    try {
      decoder.decode(new Uint8Array([0xff]));
      return false;
    } catch {
      return true;
    }
  } catch {
    return false;
  }
};

const installCrypto = (): void => {
  const subtle = {
    digest: async (_algorithm: "SHA-256", data: Uint8Array): Promise<ArrayBuffer> =>
      ExpoCrypto.digest(ExpoCrypto.CryptoDigestAlgorithm.SHA256, new Uint8Array(data)),
  };
  const crypto = {
    subtle,
    // SAFETY: expo-crypto returns an RFC 4122 version 4 UUID string.
    randomUUID: () =>
      ExpoCrypto.randomUUID() as `${string}-${string}-${string}-${string}-${string}`,
    getRandomValues: ExpoCrypto.getRandomValues,
  };
  Object.defineProperty(globalThis, "crypto", { value: crypto, configurable: true });
};

const installMissingGlobals = (): void => {
  if (!decoderMeetsContract()) {
    Object.defineProperty(globalThis, "TextDecoder", {
      value: Utf8TextDecoder,
      configurable: true,
      writable: true,
    });
  }
  // Hermes documents no Intl.Segmenter. Shared workspace initials count graphemes with it.
  if (!("Segmenter" in Intl)) {
    Object.defineProperty(Intl, "Segmenter", {
      value: GraphemeSegmenter,
      configurable: true,
      writable: true,
    });
  }
  if (!("toSorted" in Array.prototype)) {
    Object.defineProperty(Array.prototype, "toSorted", {
      value: arrayToSorted,
      configurable: true,
      writable: true,
    });
  }
  const crypto = "crypto" in globalThis ? globalThis.crypto : undefined;
  if (!crypto || !("subtle" in crypto) || !("randomUUID" in crypto)) installCrypto();
};

const REQUIRED_GLOBALS: readonly GlobalCheck[] = [
  ["AbortController", () => "AbortController" in globalThis],
  ["AbortSignal.any", () => "AbortSignal" in globalThis && "any" in AbortSignal],
  ["AbortSignal.timeout", () => "AbortSignal" in globalThis && "timeout" in AbortSignal],
  ["AbortSignal.abort", () => "AbortSignal" in globalThis && "abort" in AbortSignal],
  [
    "AbortSignal.prototype.throwIfAborted",
    () => "AbortSignal" in globalThis && "throwIfAborted" in AbortSignal.prototype,
  ],
  ["setTimeout", () => "setTimeout" in globalThis],
  ["clearTimeout", () => "clearTimeout" in globalThis],
  ["setInterval", () => "setInterval" in globalThis],
  ["clearInterval", () => "clearInterval" in globalThis],
  ["Intl.Segmenter", () => "Segmenter" in Intl],
  ["queueMicrotask", () => "queueMicrotask" in globalThis],
  ["structuredClone", () => "structuredClone" in globalThis],
  ["console", () => "console" in globalThis],
  ["crypto.randomUUID", () => "crypto" in globalThis && "randomUUID" in globalThis.crypto],
  ["crypto.subtle.digest", () => "crypto" in globalThis && "digest" in globalThis.crypto.subtle],
  ["TextEncoder", () => "TextEncoder" in globalThis],
  ["TextDecoder", decoderMeetsContract],
  ["URL", () => "URL" in globalThis],
  ["URLSearchParams", () => "URLSearchParams" in globalThis],
  ["Symbol.asyncIterator", () => Symbol.asyncIterator !== undefined],
  ["WebSocket", () => "WebSocket" in globalThis],
  ["Array.prototype.toSorted", () => "toSorted" in Array.prototype],
  ["Array.prototype.findLast", () => "findLast" in Array.prototype],
  ["Promise.withResolvers", () => "withResolvers" in Promise],
];

const missingPlatformGlobals = (): string[] =>
  REQUIRED_GLOBALS.filter(([, present]) => !present()).map(([name]) => name);

installMissingGlobals();
const missing = missingPlatformGlobals();
if (missing.length > 0) {
  throw new Error(
    `OpenDucktor cannot start because this runtime lacks ${missing.join(", ")}. Update the app build.`,
  );
}
