import { Effect } from "effect";
export const unexpectedSessionImport = {
  listRootSessionMetadataPage: () => Effect.dieMessage("Unexpected root session listing"),
  openExistingSessionForImport: () => Effect.dieMessage("Unexpected session import opening"),
};
export const unexpectedNativeSessionImport = {
  listRootSessionMetadataPage: async () => {
    throw new Error("Unexpected external session listing");
  },
  openExistingSessionForImport: async () => {
    throw new Error("Unexpected session import opening");
  },
};
