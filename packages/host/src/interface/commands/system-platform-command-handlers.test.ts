import { describe, expect, test } from "bun:test";
import {
  type CreateHostCommandRouterInput,
  createEffectHostCommandRouter,
  toPromiseHostCommandRouter,
} from "../router/host-command-router";
import { createSystemPlatformCommandHandlers } from "./system-platform-command-handlers";

const createHostCommandRouter = (input: CreateHostCommandRouterInput) =>
  toPromiseHostCommandRouter(createEffectHostCommandRouter(input));

describe("createSystemPlatformCommandHandlers", () => {
  test("routes system_get_platform to the validated platform source", async () => {
    const router = createHostCommandRouter({
      handlers: createSystemPlatformCommandHandlers(() => "linux"),
    });

    await expect(router.invoke("system_get_platform")).resolves.toBe("linux");
  });

  test("rejects unsupported host platforms with an actionable validation error", async () => {
    const router = createHostCommandRouter({
      handlers: createSystemPlatformCommandHandlers(() => "freebsd"),
    });

    await expect(router.invoke("system_get_platform")).rejects.toThrow(
      "Unsupported OpenDucktor app platform: freebsd. Supported platforms are win32, linux, and darwin.",
    );
  });
});
