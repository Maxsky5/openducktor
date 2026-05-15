export {};

type RejectMatchers = {
  toThrow(message?: string | RegExp): Promise<void>;
};

type Matchers<_T> = {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toHaveLength(expected: number): void;
  toThrow(message?: string | RegExp): void;
  rejects: RejectMatchers;
};

declare global {
  const describe: (name: string, fn: () => void | Promise<void>) => void;
  const test: (name: string, fn: () => void | Promise<void>) => void;
  function expect<T>(actual: T): Matchers<T>;
}
