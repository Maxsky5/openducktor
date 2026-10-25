// The standard runtime globals that @openducktor/frontend-core uses. Browsers and Electron supply them.
// A React Native or Expo client must supply each one, with a polyfill where its runtime lacks it.
// The package typecheck uses only these globals, so a new global use fails until you list it here.

interface AbortSignal {
  readonly aborted: boolean;
  readonly reason: unknown;
  throwIfAborted(): void;
  addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: "abort", listener: () => void): void;
}
declare var AbortSignal: {
  prototype: AbortSignal;
  abort(reason?: Error): AbortSignal;
  any(signals: AbortSignal[]): AbortSignal;
  timeout(milliseconds: number): AbortSignal;
};

interface AbortController {
  readonly signal: AbortSignal;
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The standard global takes any abort reason, as `AbortSignal.reason` is unknown.
  abort(reason?: unknown): void;
}
declare var AbortController: { prototype: AbortController; new (): AbortController };

declare function setTimeout(handler: () => void, timeout?: number): number;
declare function clearTimeout(id: number | undefined): void;
declare function setInterval(handler: () => void, timeout?: number): number;
declare function clearInterval(id: number | undefined): void;
declare function queueMicrotask(callback: () => void): void;
declare function structuredClone<T>(value: T): T;

interface Console {
  debug(...data: unknown[]): void;
  error(...data: unknown[]): void;
  info(...data: unknown[]): void;
  log(...data: unknown[]): void;
  warn(...data: unknown[]): void;
}
declare var console: Console;

interface SubtleCrypto {
  digest(algorithm: "SHA-256", data: Uint8Array): Promise<ArrayBuffer>;
}
interface Crypto {
  readonly subtle: SubtleCrypto;
  randomUUID(): `${string}-${string}-${string}-${string}-${string}`;
}
declare var crypto: Crypto;

interface TextEncoder {
  encode(input?: string): Uint8Array;
}
declare var TextEncoder: { prototype: TextEncoder; new (): TextEncoder };

interface TextDecoder {
  decode(input?: Uint8Array | ArrayBuffer, options?: { stream?: boolean }): string;
}
declare var TextDecoder: {
  prototype: TextDecoder;
  new (label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean }): TextDecoder;
};

interface URLSearchParams {
  append(name: string, value: string): void;
  get(name: string): string | null;
  set(name: string, value: string): void;
  toString(): string;
}
declare var URLSearchParams: {
  prototype: URLSearchParams;
  new (init?: string | Record<string, string>): URLSearchParams;
};

interface URL {
  hash: string;
  host: string;
  hostname: string;
  href: string;
  readonly origin: string;
  password: string;
  pathname: string;
  port: string;
  protocol: string;
  search: string;
  readonly searchParams: URLSearchParams;
  username: string;
  toString(): string;
}
declare var URL: { prototype: URL; new (url: string | URL, base?: string | URL): URL };

/** Bundlers replace `process.env.NODE_ENV` at build time. React needs this too. */
declare var process: { readonly env: { readonly NODE_ENV?: string } };
