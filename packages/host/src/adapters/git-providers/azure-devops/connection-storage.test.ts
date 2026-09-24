/* oxlint-disable anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion -- These negative tests need incomplete MSAL persistence fakes. */
import { describe, expect, mock, test } from "bun:test";
import type { IPersistence } from "@azure/msal-node-extensions";
import { Effect } from "effect";
import { HostOperationError } from "../../../effect/host-errors";
import { loadConnection, saveConnection } from "./connection-storage";
import type { AzureDevOpsProtectedStorage } from "./protected-storage";

describe("Azure DevOps connection storage", () => {
  test("reads a secure connection without opening validated persistence", async () => {
    const open = mock(() => Effect.die("Unexpected persistence validation"));
    const protectedStorage: AzureDevOpsProtectedStorage = {
      readConnection: () => Effect.succeed(JSON.stringify({ kind: "server_pat", pat: "saved" })),
      open,
    };

    await expect(Effect.runPromise(loadConnection(protectedStorage, "scope"))).resolves.toEqual({
      kind: "server_pat",
      pat: "saved",
    });
    expect(open).not.toHaveBeenCalled();
  });

  test("returns disconnected without validating persistence when no connection was saved", async () => {
    const open = mock(() => Effect.die("Unexpected protected storage open"));
    const protectedStorage: AzureDevOpsProtectedStorage = {
      readConnection: () => Effect.succeed(null),
      open,
    };

    await expect(Effect.runPromise(loadConnection(protectedStorage, "scope"))).resolves.toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  test("preserves a protected storage read failure", async () => {
    const readFailure = new HostOperationError({
      operation: "azureDevOps.connection.load",
      message: "Cannot read the secure connection",
    });
    const open = mock(() => Effect.die("Unexpected protected storage open"));
    const protectedStorage: AzureDevOpsProtectedStorage = {
      readConnection: () => Effect.fail(readFailure),
      open,
    };

    const failure = await Effect.runPromise(
      loadConnection(protectedStorage, "scope").pipe(Effect.flip),
    );
    expect(failure).toBe(readFailure);
    expect(open).not.toHaveBeenCalled();
  });

  test("rejects a syntactically valid connection record with an invalid shape", async () => {
    const protectedStorage: AzureDevOpsProtectedStorage = {
      readConnection: () => Effect.succeed(JSON.stringify({ kind: "server_pat" })),
      open: () => Effect.die("Unexpected persistence validation"),
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
      readConnection: () => Effect.die("Unexpected secure read"),
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
      readConnection: () => Effect.die("Unexpected secure read"),
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
