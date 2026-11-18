import { expect, test } from "bun:test";
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
