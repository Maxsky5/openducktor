import { Effect } from "effect";
export const unexpectedSessionImport = {
  listMetadataPage: () => Effect.dieMessage("Unexpected external session listing"),
  getMetadata: () => Effect.dieMessage("Unexpected session metadata read"),
  openForImport: () => Effect.dieMessage("Unexpected session import opening"),
};
export const unexpectedNativeSessionImport = {
  listMetadataPage: async () => {
    throw new Error("Unexpected external session listing");
  },
  getMetadata: async () => {
    throw new Error("Unexpected session metadata read");
  },
  openForImport: async () => {
    throw new Error("Unexpected session import opening");
  },
};
