import { APP_PLATFORM_VALUES, appPlatformSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { HostCommandHandlers } from "../router/host-command-router";

type PlatformSource = () => string;

const supportedPlatformsText = APP_PLATFORM_VALUES.join(", ").replace(", darwin", ", and darwin");

const requireNoArgs = (command: string, args: Record<string, unknown> | undefined): void => {
  if (args && Object.keys(args).length > 0) {
    throw new HostValidationError({ message: `${command} does not accept arguments.` });
  }
};

export const createSystemPlatformCommandHandlers = (
  platformSource: PlatformSource = () => process.platform,
): HostCommandHandlers => ({
  system_get_platform: (args) =>
    Effect.gen(function* () {
      requireNoArgs("system_get_platform", args);
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
});
