import { createHash } from "node:crypto";
import { Effect } from "effect";
import { withNotificationConfigCommit } from "../../adapters/config/notification-settings-config";
import {
  createNotificationService,
  type NotificationService,
} from "../../application/notifications/notification-service";
import type { HostEventBusPort } from "../../events/host-event-bus";
import type { SettingsConfigPort } from "../../ports/settings-config-port";

export const createNodeNotificationServices = (
  baseSettings: SettingsConfigPort,
  eventBus: HostEventBusPort | undefined,
) => {
  let service: NotificationService | undefined;
  const settingsConfig = withNotificationConfigCommit(baseSettings, (config) =>
    service ? service.configCommitted(config) : Effect.void,
  );
  return {
    settingsConfig,
    acceptLive: (...args: Parameters<NotificationService["acceptLive"]>) =>
      service?.acceptLive(...args),
    acceptTask: (...args: Parameters<NotificationService["acceptTask"]>) =>
      service?.acceptTask(...args),
    attach(
      dependencies: Pick<
        Parameters<typeof createNotificationService>[0],
        "tasks" | "live" | "workspaceSessions"
      >,
    ) {
      const notifications = createNotificationService({
        ...dependencies,
        settingsConfig,
        boundIdentity: (identity) =>
          identity.length <= 1024
            ? identity
            : `sha256:${createHash("sha256").update(identity).digest("hex")}`,
      });
      service = notifications;
      const unsubscribe = eventBus?.subscribe(
        "openducktor://workspace-session-updated",
        (event) => {
          if (event.channel === "openducktor://workspace-session-updated")
            notifications.acceptWorkspaceSession(event.payload.workspaceId, event.payload.session);
        },
      );
      return {
        ...notifications,
        dispose: () =>
          Effect.sync(() => unsubscribe?.()).pipe(Effect.zipRight(notifications.dispose())),
      };
    },
  };
};
