import assert from "node:assert/strict";
import { text } from "node:stream/consumers";
import { test } from "node:test";
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import { Agent, MockAgent, Request as UndiciRequest } from "undici";
import { fetchOpenCodeCommand } from "../src/opencode-command-fetch.ts";

test("converts an SDK command request for Undici in Node", { timeout: 500 }, async (t) => {
  assert.notEqual(globalThis.Request, UndiciRequest);
  const transport = new MockAgent();
  transport.disableNetConnect();
  t.after(() => transport.close());
  const pool = transport.get("http://opencode.test");
  t.mock.method(Agent.prototype, "dispatch", pool.dispatch.bind(pool));

  const body = {
    messageID: "message-openducktor-1",
    command: "review",
    arguments: "latest changes",
  };
  let receivedBody;
  pool
    .intercept({
      path: "/session/session-opencode-1/command?directory=%2Frepo",
      method: "POST",
      headers: { "content-type": "application/json" },
    })
    .reply(
      200,
      async (request) => {
        receivedBody = await text(request.body);
        return {};
      },
      { headers: { "content-type": "application/json" } },
    );

  const client = createOpencodeClient({ baseUrl: "http://opencode.test" });
  const result = await client.session.command(
    { sessionID: "session-opencode-1", directory: "/repo", ...body },
    { fetch: fetchOpenCodeCommand, throwOnError: true },
  );

  assert.deepEqual(result.data, {});
  assert.deepEqual(JSON.parse(receivedBody), body);
  transport.assertNoPendingInterceptors();
});
