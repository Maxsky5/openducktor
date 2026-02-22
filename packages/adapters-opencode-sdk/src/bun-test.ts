type TestFn = () => void | Promise<void>;

type Matchers = {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toMatchObject(expected: unknown): void;
  toHaveLength(expected: number): void;
  toThrow(expected?: string | RegExp): void;
  toBeNull(): void;
  toContain(expected: unknown): void;
  toBeDefined(): void;
  toBeGreaterThanOrEqual(expected: number): void;
};

const scope = globalThis as unknown as {
  describe: (name: string, fn: TestFn) => void;
  test: (name: string, fn: TestFn) => void;
  expect: (value: unknown) => Matchers;
};

export const describe = scope.describe;
export const test = scope.test;
export const expect = scope.expect;
