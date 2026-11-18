import { describe, expect, test } from "bun:test";
import { parseNamingOutput, toBranchSlug } from "./naming-output";

const both = { title: true, branch: true };

describe("naming output", () => {
  test("makes up to six lowercase words joined by hyphens", () => {
    expect(toBranchSlug("Fix the Login redirect after OAuth, then deploy it")).toBe(
      "fix-the-login-redirect-after-oauth",
    );
    expect(toBranchSlug("Réparer l'écran")).toBe("reparer-l-ecran");
    expect(toBranchSlug("¿?!")).toBe("");
  });

  test("reads a JSON answer inside a code fence", () => {
    expect(
      parseNamingOutput(
        '```json\n{"title": "\\"OAuth login redirect\\"\\nmore", "branch": "fix/OAuth Login_Redirect"}\n```',
        both,
      ),
    ).toEqual({ title: "OAuth login redirect", branch: "fix/oauth-login-redirect" });
  });

  test.each([
    ['"Title: Login redirect"', "Login redirect"],
    ['Title: "Login redirect"', "Login redirect"],
    ["Login redirect\rSecond line", "Login redirect"],
    ["Login redirect\r\nSecond line", "Login redirect"],
  ])("keeps the first line without quotes or label: %j", (title, expected) => {
    expect(parseNamingOutput(JSON.stringify({ title }), { title: true, branch: false })).toEqual({
      title: expected,
    });
  });

  test("removes a title label and keeps 120 characters", () => {
    const { title } = parseNamingOutput(JSON.stringify({ title: `Title: ${"a".repeat(200)}` }), {
      title: true,
      branch: false,
    });
    expect(title).toBe("a".repeat(120));
  });

  test.each([
    ["no JSON", "fix/login", "did not return a JSON object"],
    ["a missing field", JSON.stringify({ title: "Login fix" }), 'returned no "branch" text'],
    [
      "a branch without a type",
      JSON.stringify({ title: "Login fix", branch: "login-fix" }),
      "login-fix",
    ],
    [
      "an invalid type",
      JSON.stringify({ title: "Login fix", branch: "bad..type/login" }),
      "bad..type/login",
    ],
    ["an empty title", JSON.stringify({ title: " ", branch: "fix/login" }), "an empty title"],
  ])("rejects %s", (_case, text, message) => {
    expect(() => parseNamingOutput(text, both)).toThrow(message);
  });
});
