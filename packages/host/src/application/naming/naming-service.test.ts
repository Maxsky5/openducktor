import { describe, expect, test } from "bun:test";
import { NAMING_PROMPT_TEMPLATES } from "@openducktor/workflows";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { createModelNamingService } from "../../test-support/naming-test-doubles";
import { repoConfigFixture } from "../../test-support/repo-config-fixture";
import type { NamingKind } from "@openducktor/workflows";
import type { JsonValue } from "@openducktor/contracts";

const namingModel = { runtimeKind: "opencode", providerId: "openai", modelId: "mini" } as const;

const request = <K extends NamingKind>(kind: K, overrides = {}) => ({
  repoConfig: repoConfigFixture({ namingModel, ...overrides }),
  kind,
  workText: "First message:\nFix login",
});

const answering = (answer: JsonValue) => createModelNamingService(() => Effect.succeed(answer));

describe("naming service", () => {
  test("asks the naming model of the workspace for a constrained answer", async () => {
    const { service, requests } = answering({ title: "Login fix" });
    expect(await Effect.runPromise(service.generate(request("title")))).toEqual({
      status: "generated",
      answer: { title: "Login fix" },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.model).toEqual(namingModel);
    expect(requests[0]?.outputSchema).toMatchObject({
      type: "object",
      required: ["title"],
      additionalProperties: false,
    });
    expect(requests[0]?.prompt).toContain("First message:\nFix login");
    expect(requests[0]?.prompt).not.toContain("Name a Git branch");
  });

  test("names a branch and a title in one answer, as clean names", async () => {
    const { service, requests } = answering({
      title: '"OAuth login redirect"\nmore',
      branch: "fix/OAuth Login_Redirect",
    });
    expect(await Effect.runPromise(service.generate(request("branch_and_title")))).toEqual({
      status: "generated",
      answer: { title: "OAuth login redirect", branch: "fix/oauth-login-redirect" },
    });
    expect(requests[0]?.outputSchema).toMatchObject({ required: ["branch", "title"] });
  });

  test.each([
    ['"Title: Login redirect"', "Login redirect"],
    ['Title: "Login redirect"', "Login redirect"],
    ["Login redirect\r\nSecond line", "Login redirect"],
    [`Title: ${"a".repeat(200)}`, "a".repeat(120)],
  ])("keeps the first line of a title without quotes or label: %j", async (title, expected) => {
    const { service } = answering({ title });
    expect(await Effect.runPromise(service.generate(request("title")))).toEqual({
      status: "generated",
      answer: { title: expected },
    });
  });

  test("makes no call without a naming model", async () => {
    const { service, requests } = answering({ title: "Login fix" });
    const outcome = await Effect.runPromise(
      service.generate({ ...request("title"), repoConfig: repoConfigFixture() }),
    );
    expect(outcome).toEqual({ status: "disabled" });
    expect(requests).toEqual([]);
  });

  test("gives up after the deadline", async () => {
    const { service } = createModelNamingService(() => Effect.never);
    expect(await Effect.runPromise(service.generate(request("title")))).toEqual({
      status: "timed_out",
    });
  });

  test.each([
    ["a missing field", { title: "Login fix" }, "does not fit the output schema"],
    ["a branch without a type", { branch: "login-fix" }, "login-fix"],
    ["an invalid branch type", { branch: "bad..type/login" }, "bad..type/login"],
  ])("reports %s as a failure", async (_case, answer, message) => {
    const { service } = answering(answer);
    const outcome = await Effect.runPromise(service.generate(request("branch")));
    expect(outcome.status).toBe("failed");
    expect(outcome.status === "failed" && outcome.message).toContain(message);
  });

  test("reports an empty title and a runtime error as failures", async () => {
    const empty = await Effect.runPromise(
      answering({ title: " " }).service.generate(request("title")),
    );
    expect(empty).toEqual({
      status: "failed",
      message: "The naming model returned an empty title.",
    });
    const stopped = createModelNamingService(() =>
      Effect.fail(new HostOperationError({ operation: "test", message: "Runtime stopped." })),
    );
    expect(await Effect.runPromise(stopped.service.generate(request("title")))).toEqual({
      status: "failed",
      message: "Runtime stopped.",
    });
  });

  test("uses a workspace prompt override", async () => {
    const titlePrompt = NAMING_PROMPT_TEMPLATES.find((template) => template.output === "title");
    const { service, requests } = answering({ title: "Login fix" });
    await Effect.runPromise(
      service.generate(
        request("title", {
          promptOverrides: {
            [titlePrompt?.key ?? ""]: {
              template: "Team title rules.\n{{workText}}",
              baseVersion: 1,
            },
          },
        }),
      ),
    );
    expect(requests[0]?.prompt).toContain("Team title rules.\nFirst message:\nFix login");
  });
});
