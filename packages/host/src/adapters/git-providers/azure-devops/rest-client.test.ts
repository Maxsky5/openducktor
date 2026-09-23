/* oxlint-disable anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion -- Bun mock functions do not retain the full fetch signature. */
import { describe, expect, mock, test } from "bun:test";
import { azureDevOpsRepositorySchema, repoConfigSchema } from "@openducktor/contracts";
import { Effect, Fiber, TestClock, TestContext } from "effect";
import type { AzureDevOpsConnectionPort } from "../../../ports/azure-devops-connection-port";
import type { GitPort } from "../../../ports/git-port";
import { AzureDevOpsProviderAdapter } from "./provider-adapter";
import { createAzureDevOpsRestClient } from "./rest-client";

const repository = azureDevOpsRepositorySchema.parse({
  providerId: "azure_devops",
  deployment: "server",
  serviceUrl: "https://ado.example.test/installation/Main%20Collection",
  organization: "DefaultCollection",
  project: "Desktop App",
  name: "app",
});
const repoConfig = repoConfigSchema.parse({
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  git: { provider: { id: "azure_devops", enabled: true, repository } },
});
const connection: AzureDevOpsConnectionPort = {
  shutdown: () => Effect.void,
  getAuthorization: () => Effect.succeed({ headerValue: "Bearer secret", account: null }),
  getState: () => Effect.succeed({ status: "connected", account: null }),
  replacePat: () => Effect.void,
  startCloudSignIn: () => Effect.die("unexpected sign-in"),
  cancelCloudSignIn: () => Effect.void,
  disconnect: () => Effect.void,
};

describe("Azure DevOps REST client", () => {
  test("uses the provider adapter's network function for repository checks", async () => {
    const fetchImplementation = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer secret");
      return new Response(null, { status: 401 });
    });
    const adapter = new AzureDevOpsProviderAdapter({
      connectionPort: connection,
      fetchImplementation,
      gitPort: {} as GitPort,
    });

    const status = await Effect.runPromise(adapter.health().getStatus(repoConfig));

    expect(status.authenticated).toBe(false);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  test("constructs encoded Server URLs and follows continuation tokens", async () => {
    const urls: string[] = [];
    const fetchImplementation = mock(async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      const continued = url.includes("continuationToken=next");
      return new Response(JSON.stringify({ value: continued ? [{ id: 2 }] : [{ id: 1 }] }), {
        headers: continued ? {} : { "x-ms-continuationtoken": "next" },
      });
    });
    const client = createAzureDevOpsRestClient({
      connection,
      fetchImplementation: fetchImplementation as unknown as typeof fetch,
    });
    await expect(
      Effect.runPromise(
        client.readContinuationPages(repoConfig, repository, {
          operation: "list pull requests",
          path: "git/repositories/app/pullrequests",
        }),
      ),
    ).resolves.toEqual([{ id: 1 }, { id: 2 }]);
    expect(urls[0]).toContain(
      "https://ado.example.test/installation/Main%20Collection/DefaultCollection/Desktop%20App/_apis/git/repositories/app/pullrequests",
    );
    expect(urls[1]).toContain("continuationToken=next");
  });

  test("rejects redirects without forwarding authorization", async () => {
    const client = createAzureDevOpsRestClient({
      connection,
      fetchImplementation: mock(
        async () => new Response(null, { status: 302 }),
      ) as unknown as typeof fetch,
    });
    await expect(
      Effect.runPromise(
        client.request(repoConfig, repository, {
          operation: "read repository",
          path: "git/repositories/app",
        }),
      ),
    ).rejects.toThrow("unexpected redirect");
  });

  test("aborts a request that exceeds the Azure DevOps deadline", async () => {
    const started = Promise.withResolvers<AbortSignal | undefined>();
    const fetchImplementation = mock((_input: string | URL | Request, init?: RequestInit) => {
      const signal = init?.signal ?? undefined;
      started.resolve(signal);
      if (!signal) {
        return Promise.reject(new Error("Missing request abort signal"));
      }
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(signal.reason ?? new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    });
    const client = createAzureDevOpsRestClient({
      connection,
      fetchImplementation: fetchImplementation as unknown as typeof fetch,
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const request = yield* Effect.fork(
          Effect.either(
            client.request(repoConfig, repository, {
              operation: "read repository",
              path: "git/repositories/app",
            }),
          ),
        );
        const signal = yield* Effect.promise(() => started.promise);
        expect(signal).toBeInstanceOf(AbortSignal);
        yield* TestClock.adjust("30 seconds");
        const result = yield* Fiber.join(request);
        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left.message).toContain("timed out after 30 seconds");
        }
        expect(signal?.aborted).toBe(true);
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
  });
});
