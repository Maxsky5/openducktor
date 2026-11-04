import { describe, expect, test } from "bun:test";
import { type GitlabAccount, repoConfigSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../../effect/host-errors";
import type {
  GitlabAccountFields,
  GitlabAccountStore,
} from "../../sqlite/sqlite-gitlab-account-store";
import { createGitlabConnectionAdapter } from "./connection";
import { createGitlabHttp } from "./http";
import { decodeGitlabSecret, type GitlabSecret, type GitlabSecretStore } from "./secret-store";

type Route = (request: Request) => Response | undefined;

type JsonBody = Readonly<Record<string, string | number | boolean | string[] | null>>;

const json = (body: JsonBody, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const createHarness = (
  routes: Route[],
  now: () => number = () => Date.parse("2026-11-03T12:00:00Z"),
) => {
  const requests: Request[] = [];
  const fetchImplementation = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request);
    for (const route of routes) {
      const response = route(request);
      if (response) return response;
    }
    throw new Error(`Unexpected request ${request.method} ${request.url}`);
  };
  const rows = new Map<string, GitlabAccount>();
  const failures = { upsert: false, secretSave: false };
  const linked = new Set<string>();
  const accounts: GitlabAccountStore = {
    listByInstance: (instanceUrl) =>
      Effect.succeed([...rows.values()].filter((row) => row.instanceUrl === instanceUrl)),
    get: (accountId) => Effect.succeed(rows.get(accountId) ?? null),
    findByUser: (instanceUrl, userId) =>
      Effect.succeed(
        [...rows.values()].find(
          (row) => row.instanceUrl === instanceUrl && row.userId === userId,
        ) ?? null,
      ),
    upsert: (fields: GitlabAccountFields, accountId: string) =>
      failures.upsert
        ? Effect.fail(new HostOperationError({ operation: "test.upsert", message: "Disk full." }))
        : Effect.sync(() => {
            const existing = [...rows.values()].find(
              (row) => row.instanceUrl === fields.instanceUrl && row.userId === fields.userId,
            );
            const account = { ...fields, accountId: existing?.accountId ?? accountId };
            rows.set(account.accountId, account);
            return account;
          }),
    delete: (accountId) => Effect.sync(() => void rows.delete(accountId)),
    listUnreferenced: (candidates) =>
      Effect.succeed(
        [...rows.keys()].filter(
          (accountId) =>
            !linked.has(accountId) && (candidates === undefined || candidates.includes(accountId)),
        ),
      ),
    listKnownInstances: () =>
      Effect.succeed([...new Set([...rows.values()].map((row) => row.instanceUrl))]),
  };
  // Like the OS store, the fake keeps text, so a test can save a credential that does not decode.
  const storedSecrets = new Map<string, string>();
  const secretValues = {
    get: (accountId: string): GitlabSecret | undefined => {
      const payload = storedSecrets.get(accountId);
      return payload === undefined ? undefined : Effect.runSync(decodeGitlabSecret(payload));
    },
    set: (accountId: string, secret: GitlabSecret) =>
      void storedSecrets.set(accountId, JSON.stringify(secret)),
    setPayload: (accountId: string, payload: string) => void storedSecrets.set(accountId, payload),
    get size() {
      return storedSecrets.size;
    },
  };
  const snapshot = (accountId: string) => Effect.succeed(storedSecrets.get(accountId) ?? null);
  const secrets: GitlabSecretStore = {
    read: (accountId) =>
      snapshot(accountId).pipe(
        Effect.flatMap((payload) =>
          payload === null ? Effect.succeed(null) : decodeGitlabSecret(payload),
        ),
      ),
    // Like the OS store, a failing write can change the secret before its marker file fails.
    save: (accountId, secret) =>
      Effect.sync(() => secretValues.set(accountId, secret)).pipe(
        Effect.andThen(
          failures.secretSave
            ? Effect.fail(
                new HostOperationError({
                  operation: "test.secret",
                  message: "Marker write failed.",
                }),
              )
            : Effect.void,
        ),
      ),
    delete: (accountId) => Effect.sync(() => void storedSecrets.delete(accountId)),
    snapshot,
    restore: (accountId, payload) =>
      Effect.sync(() =>
        payload === null
          ? void storedSecrets.delete(accountId)
          : void storedSecrets.set(accountId, payload),
      ),
  };
  const connection = createGitlabConnectionAdapter({
    http: createGitlabHttp(fetchImplementation),
    accounts,
    secrets,
    clientId: "client",
    now,
  });
  return { connection, requests, rows, linked, secretValues, failures };
};

const route =
  (method: string, path: string, response: () => Response): Route =>
  (request) => {
    const url = new URL(request.url);
    return request.method === method && url.pathname === path ? response() : undefined;
  };

const selfManagedToken = (overrides: { scopes?: string[] } = {}) => [
  route("GET", "/api/v4/metadata", () => json({ version: "17.4.2-ee" })),
  route("GET", "/api/v4/personal_access_tokens/self", () =>
    json({ active: true, scopes: ["api"], user_id: 7, expires_at: "2026-11-08", ...overrides }),
  ),
  route("GET", "/api/v4/user", () => json({ id: 7, username: "alice", name: "Alice" })),
  route("GET", "/api/v4/projects/group%2Fapp", () =>
    json({ id: 42, path_with_namespace: "group/app", web_url: "https://code.corp/group/app" }),
  ),
];

describe("GitLab connection adapter", () => {
  test("checks a token before it saves the account and its secret", async () => {
    const { connection, rows, secretValues } = createHarness(selfManagedToken());
    const account = await Effect.runPromise(
      connection.addToken({
        instanceUrl: "https://Code.Corp/",
        token: " secret ",
        projectPath: "group/app",
      }),
    );
    expect(account).toMatchObject({
      instanceUrl: "https://code.corp",
      userId: 7,
      username: "alice",
      authKind: "token",
      tokenExpiresAt: "2026-11-08T00:00:00.000Z",
    });
    expect(rows.size).toBe(1);
    expect(secretValues.get(account.accountId)).toEqual({ kind: "token", token: "secret" });
  });

  test("rejects an old instance, a token without api scope, and HTTP without consent", async () => {
    const old = createHarness([
      route("GET", "/api/v4/metadata", () => json({ version: "17.3.9-ee" })),
    ]);
    const oldResult = await Effect.runPromise(
      Effect.result(old.connection.addToken({ instanceUrl: "https://code.corp", token: "t" })),
    );
    expect(oldResult._tag === "Failure" && oldResult.failure.message).toContain(
      "runs GitLab 17.3.9-ee. OpenDucktor needs GitLab 17.4",
    );
    expect(old.rows.size).toBe(0);

    const scope = createHarness(selfManagedToken({ scopes: ["read_api"] }));
    const scopeResult = await Effect.runPromise(
      Effect.result(scope.connection.addToken({ instanceUrl: "https://code.corp", token: "t" })),
    );
    expect(scopeResult._tag === "Failure" && scopeResult.failure.message).toContain("api scope");

    const http = createHarness([]);
    const httpResult = await Effect.runPromise(
      Effect.result(http.connection.addToken({ instanceUrl: "http://code.corp", token: "t" })),
    );
    expect(httpResult._tag === "Failure" && httpResult.failure.message).toContain("confirm HTTP");
    expect(http.requests).toHaveLength(0);
  });

  test("reports a URL that does not answer as GitLab", async () => {
    const { connection } = createHarness([
      route("GET", "/api/v4/metadata", () => new Response("<html>", { status: 404 })),
    ]);
    const result = await Effect.runPromise(
      Effect.result(connection.addToken({ instanceUrl: "https://example.com", token: "t" })),
    );
    expect(result._tag === "Failure" && result.failure.message).toContain(
      "did not answer as a GitLab instance",
    );
  });

  test("refuses to replace the token of an account with another user's token", async () => {
    const harness = createHarness(selfManagedToken());
    const first = await Effect.runPromise(
      harness.connection.addToken({ instanceUrl: "https://code.corp", token: "a" }),
    );
    harness.rows.set(first.accountId, { ...first, userId: 99, username: "bob" });
    const result = await Effect.runPromise(
      Effect.result(
        harness.connection.addToken({
          instanceUrl: "https://code.corp",
          token: "b",
          replaceAccountId: first.accountId,
        }),
      ),
    );
    expect(result._tag === "Failure" && result.failure.message).toContain("Use another account");
  });

  test("keeps the prior account and secret when a credential write fails", async () => {
    const harness = createHarness(selfManagedToken());
    const prior: GitlabAccount = {
      accountId: "4b0b1d5a-1c49-4f43-9f7b-5f1d2d4f0c11",
      instanceUrl: "https://code.corp",
      userId: 7,
      username: "alice",
      displayName: "Alice",
      authKind: "oauth",
      tokenExpiresAt: null,
    };
    const priorSecret: GitlabSecret = {
      kind: "oauth",
      accessToken: "access",
      refreshToken: "refresh",
      accessTokenExpiresAt: "2026-11-10T00:00:00.000Z",
    };
    harness.rows.set(prior.accountId, prior);
    harness.secretValues.set(prior.accountId, priorSecret);
    const replace = () =>
      Effect.runPromise(
        Effect.result(
          harness.connection.addToken({ instanceUrl: "https://code.corp", token: "new-token" }),
        ),
      );

    harness.failures.secretSave = true;
    expect((await replace())._tag).toBe("Failure");
    expect(harness.rows.get(prior.accountId)).toEqual(prior);
    expect(harness.secretValues.get(prior.accountId)).toEqual(priorSecret);

    harness.failures.secretSave = false;
    harness.failures.upsert = true;
    expect((await replace())._tag).toBe("Failure");
    expect(harness.rows.get(prior.accountId)).toEqual(prior);
    expect(harness.secretValues.get(prior.accountId)).toEqual(priorSecret);
  });

  test("replaces a saved credential that no longer decodes", async () => {
    const harness = createHarness(selfManagedToken());
    const prior: GitlabAccount = {
      accountId: "4b0b1d5a-1c49-4f43-9f7b-5f1d2d4f0c11",
      instanceUrl: "https://code.corp",
      userId: 7,
      username: "alice",
      displayName: "Alice",
      authKind: "token",
      tokenExpiresAt: null,
    };
    harness.rows.set(prior.accountId, prior);
    harness.secretValues.setPayload(prior.accountId, "not a credential");

    const account = await Effect.runPromise(
      harness.connection.addToken({ instanceUrl: "https://code.corp", token: "secret" }),
    );

    expect(account.accountId).toBe(prior.accountId);
    expect(harness.secretValues.get(prior.accountId)).toEqual({ kind: "token", token: "secret" });
  });

  test("reports a GitLab server error as a GitLab error to retry", async () => {
    const harness = createHarness([
      route("GET", "/api/v4/projects/group%2Fapp", () => json({ message: "500 Internal" }, 500)),
    ]);
    const account: GitlabAccount = {
      accountId: "4b0b1d5a-1c49-4f43-9f7b-5f1d2d4f0c11",
      instanceUrl: "https://code.corp",
      userId: 7,
      username: "alice",
      displayName: "Alice",
      authKind: "token",
      tokenExpiresAt: null,
    };
    harness.rows.set(account.accountId, account);
    harness.secretValues.set(account.accountId, { kind: "token", token: "t" });

    const status = await Effect.runPromise(
      harness.connection.status({
        instanceUrl: "https://code.corp",
        projectPath: "group/app",
        accountId: account.accountId,
      }),
    );

    expect(status).toMatchObject({
      status: "needs_attention",
      problem: "gitlab_error",
      actions: ["retry"],
    });
  });

  test("reports an expired token without a network request", async () => {
    const harness = createHarness([], () => Date.parse("2026-11-09T00:00:00Z"));
    const expired: GitlabAccount = {
      accountId: crypto.randomUUID(),
      instanceUrl: "https://code.corp",
      userId: 7,
      username: "alice",
      displayName: "Alice",
      authKind: "token",
      tokenExpiresAt: "2026-11-08T00:00:00.000Z",
    };
    harness.rows.set(expired.accountId, expired);
    harness.secretValues.set(expired.accountId, { kind: "token", token: "t" });
    const status = await Effect.runPromise(
      harness.connection.status({
        instanceUrl: "https://code.corp",
        projectPath: "group/app",
        accountId: expired.accountId,
      }),
    );
    expect(status).toMatchObject({
      status: "needs_attention",
      problem: "token_expired",
      actions: ["replace_token", "use_another_account"],
    });
    expect(harness.requests).toHaveLength(0);
  });

  test("renews an expiring sign-in and saves the new tokens before use", async () => {
    let refreshes = 0;
    const harness = createHarness([
      route("POST", "/oauth/token", () => {
        refreshes += 1;
        return json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 7200 });
      }),
    ]);
    const account: GitlabAccount = {
      accountId: crypto.randomUUID(),
      instanceUrl: "https://gitlab.com",
      userId: 1,
      username: "alice",
      displayName: "Alice",
      authKind: "oauth",
      tokenExpiresAt: null,
    };
    harness.rows.set(account.accountId, account);
    harness.secretValues.set(account.accountId, {
      kind: "oauth",
      accessToken: "old-access",
      refreshToken: "old-refresh",
      accessTokenExpiresAt: "2026-11-03T12:00:30Z",
    });
    const repoConfig = repoConfigSchema.parse({
      workspaceId: "repo",
      workspaceName: "Repo",
      repoPath: "/repo",
      defaultTargetBranch: { remote: "origin", branch: "main" },
      git: {
        provider: {
          id: "gitlab",
          enabled: true,
          repository: {
            providerId: "gitlab",
            instanceUrl: "https://gitlab.com",
            projectPath: "group/app",
          },
          settings: { accountId: account.accountId },
        },
      },
    });
    const authorization = await Effect.runPromise(harness.connection.authorization(repoConfig));
    expect(authorization.headerValue).toBe("Bearer new-access");
    expect(refreshes).toBe(1);
    expect(harness.secretValues.get(account.accountId)).toMatchObject({
      refreshToken: "new-refresh",
    });
  });

  test("releases only accounts that no workspace links", async () => {
    const harness = createHarness(selfManagedToken());
    const kept = await Effect.runPromise(
      harness.connection.addToken({ instanceUrl: "https://code.corp", token: "a" }),
    );
    harness.linked.add(kept.accountId);
    await Effect.runPromise(harness.connection.release([kept.accountId]));
    expect(harness.rows.has(kept.accountId)).toBe(true);
    harness.linked.delete(kept.accountId);
    await Effect.runPromise(harness.connection.sweep());
    expect(harness.rows.size).toBe(0);
    expect(harness.secretValues.size).toBe(0);
  });

  test("polls device sign-in at most once for each interval", async () => {
    let now = Date.parse("2026-11-03T12:00:00Z");
    let polls = 0;
    const routes = [
      route("POST", "/oauth/authorize_device", () =>
        json({
          device_code: "device",
          user_code: "ABCD",
          verification_uri: "https://gitlab.com/oauth/device",
          verification_uri_complete: "https://gitlab.com/oauth/device?user_code=ABCD",
          expires_in: 300,
          interval: 5,
        }),
      ),
      route("POST", "/oauth/token", () => {
        polls += 1;
        return polls === 1
          ? json({ error: "authorization_pending" }, 400)
          : json({ access_token: "access", refresh_token: "refresh", expires_in: 7200 });
      }),
      route("GET", "/api/v4/user", () => json({ id: 1, username: "alice", name: "Alice" })),
    ];
    const { connection, rows } = createHarness(routes, () => now);
    const code = await Effect.runPromise(connection.startSignIn());
    expect(code.userCode).toBe("ABCD");
    expect(await Effect.runPromise(connection.pollSignIn(code.attemptId))).toMatchObject({
      status: "pending",
    });
    expect(polls).toBe(0);
    now += 5_000;
    expect(await Effect.runPromise(connection.pollSignIn(code.attemptId))).toMatchObject({
      status: "pending",
    });
    now += 5_000;
    const connected = await Effect.runPromise(connection.pollSignIn(code.attemptId));
    expect(connected).toMatchObject({ status: "connected", account: { username: "alice" } });
    expect(polls).toBe(2);
    expect(rows.size).toBe(1);
  });
});
