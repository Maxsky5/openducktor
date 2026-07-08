import { describe, expect, test } from "bun:test";
import { HostValidationError } from "../../effect/host-errors";
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

  test("rejects unexpected args through the validation error channel", async () => {
    const router = createHostCommandRouter({
      handlers: createSystemPlatformCommandHandlers(() => {
        throw new Error("should not read platform for invalid args");
      }),
    });

    let failure: unknown;
    try {
      await router.invoke("system_get_platform", { unexpected: true });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(HostValidationError);
    expect(failure).toMatchObject({
      message: "system_get_platform does not accept arguments.",
      field: "args",
    });
  });
});
