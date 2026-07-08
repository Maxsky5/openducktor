import { APP_PLATFORM_VALUES, appPlatformSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { HostCommandHandlers } from "../router/host-command-router";

type PlatformSource = () => string;

const supportedPlatformsText =
  APP_PLATFORM_VALUES.length > 1
    ? `${APP_PLATFORM_VALUES.slice(0, -1).join(", ")}, and ${APP_PLATFORM_VALUES.at(-1)}`
    : (APP_PLATFORM_VALUES[0] ?? "");

const noArgsValidationError = (
  command: string,
  args: Record<string, unknown> | undefined,
): HostValidationError | null => {
  if (args && Object.keys(args).length > 0) {
    return new HostValidationError({
      message: `${command} does not accept arguments.`,
      field: "args",
      details: { command },
    });
  }
  return null;
};

export const createSystemPlatformCommandHandlers = (
  platformSource: PlatformSource = () => process.platform,
): HostCommandHandlers => ({
  system_get_platform: (args) =>
    Effect.gen(function* () {
      const argsError = noArgsValidationError("system_get_platform", args);
      if (argsError) {
        yield* Effect.fail(argsError);
      }

      const platform = platformSource();
      const parsed = appPlatformSchema.safeParse(platform);

      if (!parsed.success) {
        yield* Effect.fail(
          new HostValidationError({
            message: `Unsupported OpenDucktor app platform: ${platform}. Supported platforms are ${supportedPlatformsText}.`,
            field: "platform",
            details: { platform, supportedPlatforms: APP_PLATFORM_VALUES },
          }),
        );
      }

      return parsed.data;
    }),
});
