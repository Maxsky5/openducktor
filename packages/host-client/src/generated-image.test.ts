import { expect, test } from "bun:test";
import { createHostClient } from "./index";

const input = {
  ref: {
    repoPath: "/repo",
    runtimeKind: "codex" as const,
    workingDirectory: "/repo",
    externalSessionId: "thread",
  },
  itemId: "image",
  revision: "output-v1",
};
test("generated image reads validate request and response through the host transport", async () => {
  const calls: unknown[] = [];
  let result = { ...input, mime: "image/png", byteLength: 3, base64: "AAAA" };
  const client = createHostClient(async (command, args, schema) => {
    calls.push({ command, args });
    return schema.parse(result);
  });
  expect(await client.agentSessionReadGeneratedImage(input)).toEqual(result);
  expect(calls).toEqual([{ command: "agent_session_read_generated_image", args: input }]);
  const forgedInput = { ...input, path: "/secret" };
  await expect(client.agentSessionReadGeneratedImage(forgedInput)).rejects.toThrow();
  expect(calls).toHaveLength(1);
  result = { ...input, mime: "text/plain", byteLength: 3, base64: "AAAA" };
  await expect(client.agentSessionReadGeneratedImage(input)).rejects.toThrow();
});
