import { createHash } from "node:crypto";
import { Effect } from "effect";
import { withConfigCommit } from "../../adapters/config/config-commit";
import {
  createNotificationService,
  type NotificationService,
} from "../../application/notifications/notification-service";
import type { HostEventBusPort } from "../../events/host-event-bus";
import type { SettingsConfigPort, SettingsConfigView } from "../../ports/settings-config-port";

export const createNodeNotificationServices = (
  baseSettings: SettingsConfigPort,
  eventBus: HostEventBusPort | undefined,
  configCommitted: (config: SettingsConfigView) => Effect.Effect<void>,
) => {
  let service: NotificationService | undefined;
  const observedSettings = withConfigCommit(baseSettings, (config) =>
    configCommitted(config).pipe(
      Effect.andThen(service ? service.configCommitted(config) : Effect.void),
    ),
  );
  const settingsConfig: SettingsConfigPort = {
    ...observedSettings,
    updatePreferences: (change) =>
      observedSettings.updatePreferences(change).pipe(
        Effect.tap((preferences) =>
          service ? service.preferencesCommitted(preferences.notifications) : Effect.void,
        ),
        Effect.uninterruptible,
      ),
  };
  return {
    settingsConfig,
    acceptLive: (...args: Parameters<NotificationService["acceptLive"]>) =>
      service?.acceptLive(...args),
    acceptTask: (...args: Parameters<NotificationService["acceptTask"]>) =>
      service?.acceptTask(...args),
    attach(
      dependencies: Pick<
        Parameters<typeof createNotificationService>[0],
        "tasks" | "live" | "workspaceSessions" | "taskWorkflows"
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
          Effect.sync(() => unsubscribe?.()).pipe(Effect.andThen(notifications.dispose())),
      };
    },
  };
};
