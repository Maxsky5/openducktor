import { describe, expect, test } from "bun:test";
import {
  OPENDUCKTOR_DEV_INSTANCE_ENV,
  resolveDevelopmentInstanceId,
  resolveDevelopmentInstanceIdFromEnvironment,
} from "./development-instance";

describe("development instance identity", () => {
  test("derives a stable mode-scoped identity from the canonical worktree path", () => {
    const resolveCanonicalPath = () => "/worktrees/openducktor/feature-a";

    const browserId = resolveDevelopmentInstanceId(
      "browser",
      "/worktrees/openducktor/feature-a-link",
      resolveCanonicalPath,
    );
    const electronId = resolveDevelopmentInstanceId(
      "electron",
      "/worktrees/openducktor/feature-a-link",
      resolveCanonicalPath,
    );

    expect(browserId).toMatch(/^browser-[a-f0-9]{12}$/);
    expect(electronId).toMatch(/^electron-[a-f0-9]{12}$/);
    expect(browserId.slice("browser-".length)).toBe(electronId.slice("electron-".length));
  });

  test("reads only valid development instance values from the environment", () => {
    expect(
      resolveDevelopmentInstanceIdFromEnvironment({
        [OPENDUCKTOR_DEV_INSTANCE_ENV]: "browser-0123456789ab",
      }),
    ).toBe("browser-0123456789ab");

    expect(() => resolveDevelopmentInstanceIdFromEnvironment({})).toThrow(
      "OPENDUCKTOR_DEV_INSTANCE is required",
    );
    expect(() =>
      resolveDevelopmentInstanceIdFromEnvironment({
        [OPENDUCKTOR_DEV_INSTANCE_ENV]: "../other-worktree",
      }),
    ).toThrow("OPENDUCKTOR_DEV_INSTANCE must match");
  });
});
