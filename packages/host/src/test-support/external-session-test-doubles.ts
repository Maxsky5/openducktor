import { Effect } from "effect";
export const unexpectedExternalSessions = {
  list: () => Effect.dieMessage("Unexpected external session listing"),
  inspect: () => Effect.dieMessage("Unexpected external session inspection"),
  prepare: () => Effect.dieMessage("Unexpected external session preparation"),
};
export const unexpectedNativeExternalSessions = {
  list: async () => {
    throw new Error("Unexpected external session listing");
  },
  inspect: async () => {
    throw new Error("Unexpected external session inspection");
  },
  prepare: async () => {
    throw new Error("Unexpected external session preparation");
  },
};
