import { expect, test } from "bun:test";
import { agentJsonOutputSchema } from "@openducktor/contracts";
import { z } from "zod";
import { createController, response } from "./opencode-v2.test-support";

const input = {
  repoPath: "/repo",
  model: { runtimeKind: "opencode", providerId: "openai", modelId: "mini" },
  instructions: "Name the branch.",
  prompt: "First message:\nFix login",
} as const;

test("sends one stateless request and returns its text", async () => {
  const { controller, requests } = createController(async () => response({ text: "fix/login" }));
  expect(await controller.generateText(input, new AbortController().signal)).toBe("fix/login");
  expect(requests).toHaveLength(1);
  expect(requests[0]?.body).toMatchObject({
    prompt: "Name the branch.\n\nFirst message:\nFix login",
  });
});

test("cancels the HTTP request when the caller gives up", async () => {
  const abort = new AbortController();
  const { controller, requests } = createController(
    (request) =>
      new Promise<Response>((_resolve, reject) => {
        request.signal?.addEventListener("abort", () => reject(request.signal?.reason), {
          once: true,
        });
        abort.abort(new Error("Naming timed out."));
      }),
  );
  await expect(controller.generateText(input, abort.signal)).rejects.toThrow();
  expect(requests[0]?.signal?.aborted).toBe(true);
});

const answerSchema = z.strictObject({ branch: z.string() });

test("puts the output schema in the prompt and reads the JSON object of the answer", async () => {
  const { controller, requests } = createController(async () =>
    response({ text: 'Here it is:\n```json\n{"branch":"fix/login"}\n```' }),
  );
  expect(
    await controller.generateJson({ ...input, answerSchema }, new AbortController().signal),
  ).toEqual({ branch: "fix/login" });
  expect(requests[0]?.body).toMatchObject({
    prompt: `Name the branch.\n\nReturn only one JSON object that matches this JSON Schema, with no Markdown or other text:\n${JSON.stringify(agentJsonOutputSchema(answerSchema))}\n\nFirst message:\nFix login`,
  });
});

test.each([
  ["no JSON object", "fix/login", "OpenCode returned no JSON object"],
  ["a JSON object that does not parse", "{branch: fix}", "does not parse"],
  ["a JSON object of another shape", '{"name":"fix/login"}', "does not fit the output schema"],
])("reports an answer with %s", async (_case, text, message) => {
  const { controller } = createController(async () => response({ text }));
  await expect(
    controller.generateJson({ ...input, answerSchema }, new AbortController().signal),
  ).rejects.toThrow(message);
});
