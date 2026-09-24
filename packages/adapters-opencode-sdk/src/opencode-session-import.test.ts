import { expect, test } from "bun:test";
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import { createOpenCodeSessionImportPort } from "./opencode-session-import";
const ref = {
  repoPath: "/repo",
  runtimeKind: "opencode" as const,
  workingDirectory: "/repo",
  externalSessionId: "native",
};
test("OpenCode V2 discovery pages metadata and registers only after import", async () => {
  const calls: string[] = [];
  const admitted: string[] = [];
  const native = {
    id: "native",
    title: "Native title",
    agent: "plan",
    model: { providerID: "openai", id: "native-model", variant: "high" },
    location: { directory: "/repo" },
    time: { updated: 123 },
  };
  const client = createOpencodeClient({
    baseUrl: "http://runtime",
    fetch: async (request) => {
      const url = new URL(request.url);
      calls.push(url.pathname);
      const body = url.pathname.endsWith("/native")
        ? { data: native }
        : url.searchParams.has("cursor")
          ? { data: [], cursor: { next: null } }
          : {
              data: [
                native,
                { ...native, id: "child", parentID: "native" },
                {
                  ...native,
                  id: "remote",
                  location: { directory: "/repo", workspaceID: "remote" },
                },
              ],
              cursor: { next: "page-two" },
            };
      return new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" },
      });
    },
  });
  const sessions = createOpenCodeSessionImportPort({
    createClient: () => client,
    runtimeEndpoint: "http://runtime",
    admit: async (input) => {
      admitted.push(input.externalSessionId);
    },
  });
  const scanner = sessions.scanSessions(new AbortController().signal)[Symbol.asyncIterator]();
  const first = await scanner.next();
  expect(first.value).toEqual(
    [{ ...ref, title: "Native title", updatedAt: 123 }].map(({ repoPath: _repo, ...row }) => row),
  );
  expect((await scanner.next()).value).toEqual([]);
  expect((await scanner.next()).done).toBe(true);
  const source = await sessions.inspectSession(ref);
  expect(source.selectedModel).toEqual({
    runtimeKind: "opencode",
    providerId: "openai",
    modelId: "native-model",
    profileId: "plan",
    variant: "high",
  });
  expect(admitted).toEqual([]);
  await source.attach();
  expect(admitted).toEqual(["native"]);
  expect(calls.every((path) => !path.includes("message") && !path.includes("prompt"))).toBe(true);
  await expect(sessions.inspectSession({ ...ref, workingDirectory: "/different" })).rejects.toThrow(
    "directory changed",
  );
});

test.each([null, undefined])("OpenCode accepts terminal cursor %s", async (next) => {
  const client = createOpencodeClient({
    baseUrl: "http://runtime",
    fetch: async () =>
      new Response(JSON.stringify({ data: [], cursor: { next } }), {
        headers: { "content-type": "application/json" },
      }),
  });
  const sessions = createOpenCodeSessionImportPort({
    createClient: () => client,
    runtimeEndpoint: "http://runtime",
    admit: async () => {},
  });
  const scanner = sessions.scanSessions(new AbortController().signal)[Symbol.asyncIterator]();
  expect((await scanner.next()).value).toEqual([]);
  expect((await scanner.next()).done).toBe(true);
});
