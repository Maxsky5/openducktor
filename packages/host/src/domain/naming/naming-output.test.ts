import { expect, test } from "bun:test";
import { toBranchSlug } from "./naming-output";

test("a branch slug has up to six lowercase words joined by hyphens", () => {
  expect(toBranchSlug("Fix the Login redirect after OAuth, then deploy it")).toBe(
    "fix-the-login-redirect-after-oauth",
  );
  expect(toBranchSlug("Réparer l'écran")).toBe("reparer-l-ecran");
  expect(toBranchSlug("¿?!")).toBe("");
});
