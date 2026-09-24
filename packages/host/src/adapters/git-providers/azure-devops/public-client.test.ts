/* oxlint-disable anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion -- This test uses a partial MSAL persistence fake and inspects private runtime configuration. */
import { describe, expect, test } from "bun:test";
import type { IPersistence } from "@azure/msal-node-extensions";
import { Effect } from "effect";
import type { AzureDevOpsProtectedStorage } from "./protected-storage";
import { createAzureDevOpsPublicClient } from "./public-client";

const testWithNativeStorage = process.platform === "linux" ? test.skip : test;

describe("Azure DevOps public client", () => {
  testWithNativeStorage("uses the locked MSAL persistence cache plugin", async () => {
    const persistence = {
      save: async () => undefined,
      load: async () => null,
      delete: async () => false,
      getFilePath: () => "/tmp/openducktor-msal-test.cache",
      getLogger: () => ({
        error: () => undefined,
        warning: () => undefined,
        info: () => undefined,
        verbose: () => undefined,
        trace: () => undefined,
      }),
      reloadNecessary: async () => true,
    } as unknown as IPersistence;
    const protectedStorage: AzureDevOpsProtectedStorage = {
      readConnection: () => Effect.succeed(null),
      open: () => Effect.succeed(persistence),
    };

    const client = await Effect.runPromise(
      createAzureDevOpsPublicClient("client-id", protectedStorage, "scope"),
    );
    // SAFETY: This test inspects the runtime configuration retained by the installed MSAL client.
    const configured = client as unknown as {
      config: {
        auth: { authority: string };
        cache: { cachePlugin: unknown };
      };
    };

    expect(configured.config.auth.authority).toBe("https://login.microsoftonline.com/common");
    expect(configured.config.cache.cachePlugin?.constructor.name).toBe("PersistenceCachePlugin");
  });
});
