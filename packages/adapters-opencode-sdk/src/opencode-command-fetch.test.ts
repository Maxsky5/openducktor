import { expect, test } from "bun:test";

test("executes an installed SDK slash command through the Node fetch bridge", async () => {
  const node = Bun.which("node");
  expect(node).not.toBeNull();

  const moduleUrl = new URL("./opencode-command-fetch.ts", import.meta.url).href;
  const script = `
    import { createServer } from "node:http";
    const { createOpencodeClient } = await import("@opencode-ai/sdk/v2/client");
    const { fetchOpenCodeCommand } = await import(${JSON.stringify(moduleUrl)});
    let resolveReceived;
    const received = new Promise((resolve) => { resolveReceived = resolve; });
    const server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      resolveReceived({
        method: request.method,
        contentType: request.headers["content-type"],
        body,
      });
      response.setHeader("content-type", "application/json");
      response.end("{}");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      const client = createOpencodeClient({ baseUrl: "http://127.0.0.1:" + address.port });
      await client.session.command({
        sessionID: "session-opencode-1",
        directory: "/repo",
        messageID: "message-openducktor-1",
        command: "review",
        arguments: "latest changes",
      }, { fetch: fetchOpenCodeCommand });
      console.log(JSON.stringify(await received));
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    `;
  const child = Bun.spawn(
    [node!, "--experimental-strip-types", "--input-type=module", "-e", script],
    {
      cwd: import.meta.dir,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  expect(exitCode, stderr).toBe(0);
  const received = JSON.parse(stdout);
  expect(received).toMatchObject({
    method: "POST",
    contentType: "application/json",
  });
  expect(JSON.parse(received.body)).toMatchObject({
    messageID: "message-openducktor-1",
    command: "review",
    arguments: "latest changes",
  });
}, 5_000);
