import { notificationActionOccurrenceSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { NotificationService } from "../../application/notifications/notification-service";
import type { HostCommandArgs } from "./command-inputs";

export const createNotificationCommandHandlers = (service: NotificationService) => ({
  notification_publish_action: (args: HostCommandArgs) =>
    Effect.try({
      try: () => notificationActionOccurrenceSchema.parse(args),
      catch: (cause) =>
        new HostValidationError({
          field: "occurrence",
          message: "Invalid session action notification. Reload the application.",
          cause,
        }),
    }).pipe(Effect.flatMap(service.publishAction)),
});
