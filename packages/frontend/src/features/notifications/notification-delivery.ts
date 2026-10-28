import type {
  NotificationCue,
  NotificationNavigationTarget,
  NotificationOccurrence,
} from "@openducktor/contracts";
import { play as playCuelume, type SoundName, unlock as unlockCuelume } from "cuelume";
import { createElement, type ReactNode } from "react";
import { toast } from "sonner";
import type { NotificationCopy } from "@openducktor/frontend-core/notifications/notification-copy";
import { notificationCueSounds } from "./notification-sound";
import { NotificationOpenLabel } from "@/components/ui/sonner";
import { notificationClassNames } from "@/lib/sonner-feedback";

type SonnerNotificationOptions = {
  id: string;
  description: string;
  duration: number;
  closeButton: boolean;
  classNames: {
    toast: string;
    content: string;
    actionButton: string;
  };
  action: {
    label: ReactNode;
    onClick(): void;
  };
};

type ShowToast = (title: string, options: SonnerNotificationOptions) => string | number;

export const createSonnerNotificationAdapter = ({
  showToast = (title, options) => toast(title, options),
  dismissToast = (id) => toast.dismiss(id),
  navigate,
}: {
  showToast?: ShowToast;
  dismissToast?: (id: string) => void;
  navigate(target: NotificationNavigationTarget): Promise<void>;
}) => ({
  dismiss(occurrenceId: string): void {
    dismissToast(occurrenceId);
  },
  async deliver(copy: NotificationCopy, occurrence: NotificationOccurrence): Promise<void> {
    showToast(copy.title, {
      id: occurrence.occurrenceId,
      description: copy.body,
      duration: 10_000,
      closeButton: true,
      classNames: notificationClassNames,
      action: {
        label: createElement(NotificationOpenLabel),
        onClick: () => {
          void navigate(occurrence.navigationTarget);
        },
      },
    });
  },
});

type PlayCuelume = (sound?: SoundName, options?: { volume?: number }) => void;

export const createCuelumeNotificationSoundAdapter = (play: PlayCuelume = playCuelume) => ({
  async play(cue: NotificationCue, volumePercent: number): Promise<void> {
    play(notificationCueSounds[cue], { volume: volumePercent / 100 });
  },
});

export type GestureTarget = {
  addEventListener(type: string, listener: EventListener, options?: AddEventListenerOptions): void;
  removeEventListener(type: string, listener: EventListener): void;
};

export const installCuelumeGestureUnlock = ({
  unlock = unlockCuelume,
  target = document,
}: {
  unlock?: typeof unlockCuelume;
  target?: GestureTarget;
} = {}): (() => void) => {
  let attempted = false;
  const onGesture = (): void => {
    if (attempted) {
      return;
    }
    attempted = true;
    target.removeEventListener("pointerdown", onGesture);
    target.removeEventListener("keydown", onGesture);
    void unlock();
  };

  target.addEventListener("pointerdown", onGesture, { passive: true });
  target.addEventListener("keydown", onGesture);

  return () => {
    target.removeEventListener("pointerdown", onGesture);
    target.removeEventListener("keydown", onGesture);
  };
};
