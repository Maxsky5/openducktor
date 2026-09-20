import { expect, test } from "bun:test";
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import { createOpenCodeExternalSessions } from "./external-sessions";
const ref = {
  repoPath: "/repo",
  runtimeKind: "opencode" as const,
  workingDirectory: "/repo",
  externalSessionId: "native",
};
test("OpenCode V2 discovery paginates metadata and passive preparation waits for commit", async () => {
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
        : {
            data: [
              native,
              { ...native, id: "child", parentID: "native" },
              { ...native, id: "remote", location: { directory: "/repo", workspaceID: "remote" } },
            ],
            cursor: { next: "page-two" },
          };
      return new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" },
      });
    },
  });
  const sessions = createOpenCodeExternalSessions({
    createClient: () => client,
    runtimeEndpoint: "http://runtime",
    admit: async (input) => {
      admitted.push(input.externalSessionId);
    },
  });
  const page = await sessions.list({ signal: new AbortController().signal });
  expect(page.sessions).toEqual(
    [{ ...ref, title: "Native title", updatedAt: 123 }].map(({ repoPath: _repo, ...row }) => row),
  );
  expect(page.nextCursor).toBe("page-two");
  const prepared = await sessions.prepare(ref);
  expect(prepared.selectedModel).toEqual({
    runtimeKind: "opencode",
    providerId: "openai",
    modelId: "native-model",
    profileId: "plan",
    variant: "high",
  });
  expect(admitted).toEqual([]);
  await prepared.commit();
  await prepared.dispose();
  expect(admitted).toEqual(["native"]);
  expect(calls.every((path) => !path.includes("message") && !path.includes("prompt"))).toBe(true);
  await expect(sessions.inspect({ ...ref, workingDirectory: "/different" })).rejects.toThrow(
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
  const sessions = createOpenCodeExternalSessions({
    createClient: () => client,
    runtimeEndpoint: "http://runtime",
    admit: async () => {},
  });
  expect(await sessions.list({ signal: new AbortController().signal })).toEqual({
    sessions: [],
    nextCursor: null,
  });
});
