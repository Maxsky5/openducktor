/* oxlint-disable anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion -- These negative tests need incomplete MSAL persistence fakes. */
import { describe, expect, test } from "bun:test";
import type { IPersistence } from "@azure/msal-node-extensions";
import { Effect } from "effect";
import { HostOperationError } from "../../../effect/host-errors";
import { loadConnection, saveConnection } from "./connection-storage";
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

  test("preserves a protected storage open failure", async () => {
    const openFailure = new HostOperationError({
      operation: "azureDevOps.protectedStorage.open",
      message: "Credential store unavailable",
    });
    const protectedStorage: AzureDevOpsProtectedStorage = {
      open: () => Effect.fail(openFailure),
    };

    const failure = await Effect.runPromise(
      saveConnection(protectedStorage, "scope", { kind: "server_pat", pat: "pat" }).pipe(
        Effect.flip,
      ),
    );
    expect(failure).toBe(openFailure);
  });

  test("reports a protected storage save failure", async () => {
    const protectedStorage: AzureDevOpsProtectedStorage = {
      open: () =>
        Effect.succeed({
          load: async () => "",
          save: async () => {
            throw new Error("Disk full");
          },
        } as unknown as IPersistence),
    };

    const failure = await Effect.runPromise(
      saveConnection(protectedStorage, "scope", { kind: "server_pat", pat: "pat" }).pipe(
        Effect.flip,
      ),
    );
    expect(failure).toMatchObject({
      operation: "azureDevOps.connection.save",
      message: "Disk full",
    });
  });
});
