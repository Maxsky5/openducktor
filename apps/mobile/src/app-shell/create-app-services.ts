import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { deleteHostStore, openAppStore, openHostStore } from "@/device-data/mmkv-stores";
import { createFeedbackStore } from "@/feedback/feedback-store";
import { appActivitySource, createDeviceNetworkSource } from "@/host-session/device-sources";
import { createHostSessionOwner } from "@/host-session/host-session-owner";
import { BACKGROUND_GRACE_MS, startLifecycleController } from "@/host-session/lifecycle-controller";
import { createAttachmentStager } from "@/platform/attachment-stager";
import { createDeviceRemoteTransport } from "@/platform/remote-transport";
import { clearResourceCache } from "@/platform/resource-files";
import { createDevicePreferences } from "@/preferences/device-preferences";
import { appVersionLabel } from "@/platform/app-version";
import type { AppServices } from "./app-services";
import { followThemePreference } from "./app-theme";

/** Creates the device services of this app process and restores the last active host. */
export const createAppServices = (): AppServices => {
  // Resource files of an earlier run belong to connections that no longer exist.
  clearResourceCache();
  const appStore = openAppStore();
  const feedback = createFeedbackStore();
  const network = createDeviceNetworkSource();
  const owner = createHostSessionOwner({
    appStore,
    openHostStore,
    deleteHostStore,
    createTransport: createDeviceRemoteTransport,
    createHostId: () => crypto.randomUUID(),
    // Hosts show this version in compatibility failures, such as `mobile-1.0.0 (42)`.
    appVersion: `mobile-${appVersionLabel()}`,
    feedback: feedback.feedback,
    createAttachmentStager,
    startLifecycle: (session) =>
      startLifecycleController(
        appActivitySource,
        network,
        {
          remote: session.remote.remote,
          saveDrafts: () => session.connection.saveDrafts(),
          // The system can end the app in the background, so the notice stays until a dismissal. A
          // stable ID keeps one notice for repeated failures.
          onDraftSaveFailure: (cause) =>
            feedback.feedback.show("error", `Some drafts for ${session.host.label} are not saved`, {
              id: `draft-save-${session.sessionKey}`,
              description: errorMessage(cause),
              duration: Infinity,
            }),
        },
        BACKGROUND_GRACE_MS,
      ),
  });
  const preferences = createDevicePreferences(appStore);
  followThemePreference(preferences);
  const services: AppServices = { owner, preferences, feedback };
  owner.start();
  return services;
};
