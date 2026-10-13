import { describe, expect, test } from "bun:test";
import { gitHubAvatarUrl, gravatarUrl } from "./git-history-avatar";

describe("author photos", () => {
  test("reads the GitHub account from a no-reply email", () => {
    expect(gitHubAvatarUrl("12345+octo-cat@users.noreply.github.com")).toBe(
      "https://avatars.githubusercontent.com/u/12345?s=64&v=4",
    );
    expect(gitHubAvatarUrl(" Octo-Cat@Users.Noreply.GitHub.com ")).toBe(
      "https://github.com/octo-cat.png?size=64",
    );
    expect(gitHubAvatarUrl("ada@example.invalid")).toBeNull();
  });

  test("asks Gravatar for a 404 when the email has no photo, so the initials show", () => {
    expect(gravatarUrl("ab".repeat(32))).toBe(
      `https://gravatar.com/avatar/${"ab".repeat(32)}?s=64&d=404`,
    );
  });
});
