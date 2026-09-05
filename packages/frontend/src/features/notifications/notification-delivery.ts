import type {
  NotificationCue,
  NotificationNavigationTarget,
  NotificationOccurrence,
} from "@openducktor/contracts";
import { play as playCuelume, type SoundName } from "cuelume";
import { toast } from "sonner";
import type { NotificationCopy } from "./notification-copy";
import type { NotificationBridge } from "@/lib/shell-bridge";

type SonnerNotificationOptions = {
  description: string;
  duration: number;
  action: {
    label: string;
    onClick(): void;
  };
};

type ShowToast = (title: string, options: SonnerNotificationOptions) => string | number;

export const createSonnerNotificationAdapter = ({
  showToast = (title, options) => toast(title, options),
  navigate,
}: {
  showToast?: ShowToast;
  navigate(target: NotificationNavigationTarget): Promise<void>;
}) => ({
  async deliver(copy: NotificationCopy, occurrence: NotificationOccurrence): Promise<void> {
    showToast(copy.title, {
      description: copy.body,
      duration: 10_000,
      action: {
        label: "Open",
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
    play(cue, { volume: volumePercent / 100 });
  },
});

export const createShellOsNotificationAdapter = (
  bridge: NotificationBridge,
  onShown: () => void = () => {},
) => ({
  async deliver(copy: NotificationCopy, occurrence: NotificationOccurrence): Promise<void> {
    const result = await bridge.showOsNotification({
      occurrenceId: occurrence.occurrenceId,
      title: copy.title,
      body: copy.body,
      silent: true,
      navigationTarget: occurrence.navigationTarget,
    });
    if (result.status !== "shown") {
      throw new Error(result.message);
    }
    onShown();
  },
});

export type GestureTarget = {
  addEventListener(type: string, listener: EventListener, options?: AddEventListenerOptions): void;
  removeEventListener(type: string, listener: EventListener): void;
};
const CUELUME_UNLOCK_VOLUME = 0.000_001;

export const installCuelumeGestureUnlock = ({
  play = playCuelume,
  target = document,
}: {
  play?: PlayCuelume;
  target?: GestureTarget;
} = {}): (() => void) => {
  let unlocked = false;
  const unlock = (): void => {
    if (unlocked) {
      return;
    }
    unlocked = true;
    target.removeEventListener("pointerdown", unlock);
    target.removeEventListener("keydown", unlock);
    play("chime", { volume: CUELUME_UNLOCK_VOLUME });
  };

  target.addEventListener("pointerdown", unlock, { passive: true });
  target.addEventListener("keydown", unlock);

  return () => {
    target.removeEventListener("pointerdown", unlock);
    target.removeEventListener("keydown", unlock);
  };
};
