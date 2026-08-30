import { APP_PLATFORM_VALUES, appPlatformSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import type { HostCommandArgs } from "./command-inputs";

type PlatformSource = () => string;

const supportedPlatformsText =
  APP_PLATFORM_VALUES.length > 1
    ? `${APP_PLATFORM_VALUES.slice(0, -1).join(", ")}, and ${APP_PLATFORM_VALUES.at(-1)}`
    : (APP_PLATFORM_VALUES[0] ?? "");

const noArgsValidationError = (
  command: string,
  args: HostCommandArgs,
): HostValidationError<{ command: string }> | null => {
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
) =>
  ({
    system_get_platform: (args) =>
      Effect.gen(function* () {
        const argsError = noArgsValidationError("system_get_platform", args);
        if (argsError) {
          return yield* Effect.fail(argsError);
        }

        const platform = platformSource();
        const parsed = appPlatformSchema.safeParse(platform);

        if (!parsed.success) {
          return yield* Effect.fail(
            new HostValidationError({
              message: `Unsupported OpenDucktor app platform: ${platform}. Supported platforms are ${supportedPlatformsText}.`,
              field: "platform",
              details: { platform, supportedPlatforms: APP_PLATFORM_VALUES },
            }),
          );
        }

        return parsed.data;
      }),
  }) satisfies HostCommandHandlerDefinitions;
