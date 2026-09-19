/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion -- This negative test needs a deliberately incomplete MSAL persistence fake. */
import { describe, expect, test } from "bun:test";
import type { IPersistence } from "@azure/msal-node-extensions";
import { Effect } from "effect";
import { loadConnection } from "./connection-storage";
import type { AzureDevOpsProtectedStorage } from "./protected-storage";

describe("Azure DevOps connection storage", () => {
  test("rejects a syntactically valid connection record with an invalid shape", async () => {
    const protectedStorage: AzureDevOpsProtectedStorage = {
      open: () =>
        Effect.succeed({
          load: async () => JSON.stringify({ kind: "server_pat" }),
        } as IPersistence),
    };

    await expect(Effect.runPromise(loadConnection(protectedStorage, "scope"))).rejects.toThrow(
      "protected Azure DevOps connection record is invalid",
    );
  });
});
