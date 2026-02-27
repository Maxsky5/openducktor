export type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export const parseArray = <T>(schema: { parse: (value: unknown) => T }, payload: unknown): T[] => {
  if (!Array.isArray(payload)) {
    throw new Error("Expected array payload from host command");
  }
  return payload.map((entry) => schema.parse(entry));
};
