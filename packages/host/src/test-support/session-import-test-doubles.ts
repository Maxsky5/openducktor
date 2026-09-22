import { Effect } from "effect";
export const unexpectedSessionImport = {
  listRootSessionMetadataPage: () => Effect.dieMessage("Unexpected root session listing"),
  verifyImportSource: () => Effect.dieMessage("Unexpected import source check"),
  openExistingSessionForImport: () => Effect.dieMessage("Unexpected session import opening"),
};
export const unexpectedNativeSessionImport = {
  listRootSessionMetadataPage: async () => {
    throw new Error("Unexpected external session listing");
  },
  verifyImportSource: async () => {
    throw new Error("Unexpected session metadata read");
  },
  openExistingSessionForImport: async () => {
    throw new Error("Unexpected session import opening");
  },
};
