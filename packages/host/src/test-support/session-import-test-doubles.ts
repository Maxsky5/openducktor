import { Effect } from "effect";
export const unexpectedSessionImport = {
  scanSessions: () => ({ next: () => Effect.dieMessage("Unexpected session listing") }),
  inspectSession: () => Effect.dieMessage("Unexpected session import inspection"),
};
export const unexpectedNativeSessionImport = {
  scanSessions: () => ({
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        throw new Error("Unexpected external session listing");
      },
    }),
  }),
  inspectSession: async () => {
    throw new Error("Unexpected session import inspection");
  },
};
