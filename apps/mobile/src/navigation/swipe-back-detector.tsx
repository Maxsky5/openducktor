import { type PropsWithChildren, type ReactElement, useEffect } from "react";
import { findNodeHandle, Platform, useWindowDimensions } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import {
  type AnimatedScreenTransition,
  type ScreenTransitionConfig,
  startScreenTransition,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import type { GestureProviderProps } from "react-native-screens";
// `GestureDetectorProvider` gives the stack its detector through this context. The app gives its
// own detector, so the context comes from the source module that `ScreenStack` reads.
import { GHContext } from "react-native-screens/src/contexts";

/**
 * A swipe back starts anywhere on the screen once the finger moves this far to the end side. A
 * horizontal scroll view under the finger, such as a code block, takes the touch first.
 */
const START_DISTANCE = 16;
/** A release past this part of the width, or a flick, goes back. */
const BACK_FRACTION = 1 / 3;
/** A release faster than this, in points per second, goes back at any distance. */
const FLICK_VELOCITY = 500;
const SETTLE = { duration: 300, dampingRatio: 1, overshootClamping: true } as const;

type ShadowNode = ScreenTransitionConfig["topScreenId"];
type ScreenRef = NonNullable<GestureProviderProps["screensRefs"]>["current"][string]["current"];
/** The Fabric fields of a host instance that react-native-screens reads for this transition. */
type HostInstance = NonNullable<ScreenRef> & {
  __nativeTag: number;
  __internalInstanceHandle: { stateNode: { node: ShadowNode } };
};
type TurboModule = {
  startTransition: (stackTag: number) => {
    topScreenTag: number;
    belowTopScreenTag: number;
    canStartTransition: boolean;
  };
  updateTransition: (stackTag: number, progress: number) => void;
  finishTransition: (stackTag: number, canceled: boolean) => void;
};

// SAFETY: react-native-screens installs this JSI module when it loads. It is absent only when
// the native library is missing, and the swipe then stays off.
const screensModule = (globalThis as { RNScreensTurboModule?: TurboModule }).RNScreensTurboModule;

/**
 * The top screen follows the finger and the screen below stays still. The native bar of a root
 * screen draws outside its screen view, so a moving screen below would leave its bar behind.
 */
const SWIPE_BACK: AnimatedScreenTransition = {
  topScreenStyle: (event) => {
    "worklet";
    return { transform: [{ translateX: event.translationX }] };
  },
  belowTopScreenStyle: () => {
    "worklet";
    return {};
  },
};

const at = (translationX: number) => {
  "worklet";
  return {
    x: 0,
    y: 0,
    absoluteX: 0,
    absoluteY: 0,
    translationX,
    translationY: 0,
    velocityX: 0,
    velocityY: 0,
  };
};

/**
 * The Android swipe back of a native stack. The finger moves the top screen on the UI thread and
 * shows the screen below. A release past a third of the width, or a flick, goes back.
 *
 * `ScreenStack` warns about a detector with another name, so the component keeps the name of the
 * react-native-screens detector.
 */
function GHWrapper({
  children,
  gestureDetectorBridge,
  goBackGesture,
  screensRefs,
}: PropsWithChildren<GestureProviderProps>): ReactElement {
  const { width, height } = useWindowDimensions();
  const stackTag = useSharedValue(-1);
  const screens = useSharedValue<Record<number, ShadowNode>>({});
  const event = useSharedValue(at(0));
  const drive = useSharedValue(0);
  // `active` stays true until the settle after a release ends; `tracking` is true only while a
  // finger moves the screen.
  const active = useSharedValue(false);
  const tracking = useSharedValue(false);

  // Children run their effects first, so the stack calls this callback after it is set.
  useEffect(() => {
    gestureDetectorBridge.current.stackUseEffectCallback = (stackRef) => {
      stackTag.set(findNodeHandle(stackRef.current) ?? -1);
    };
  });
  // The stack renders again for each pushed or popped screen, so the map stays current.
  useEffect(() => {
    const next: Record<number, ShadowNode> = {};
    for (const ref of Object.values(screensRefs?.current ?? {})) {
      // SAFETY: a native stack screen ref is a Fabric host instance.
      const host = ref.current as HostInstance | null;
      if (host) next[host.__nativeTag] = host.__internalInstanceHandle.stateNode.node;
    }
    screens.set(next);
  });

  const pan = usePanGesture({
    enabled: goBackGesture !== undefined && screensModule !== undefined,
    activeOffsetX: START_DISTANCE,
    failOffsetX: -START_DISTANCE,
    failOffsetY: [-START_DISTANCE, START_DISTANCE],
    onActivate: () => {
      // A swipe during the settle of the last one does nothing, so the settle ends the transition
      // with its own decision.
      if (!screensModule || active.get()) return;
      const tag = stackTag.get();
      const transition = screensModule.startTransition(tag);
      if (!transition.canStartTransition) return;
      const top = screens.get()[transition.topScreenTag];
      const below = screens.get()[transition.belowTopScreenTag];
      if (top === undefined || below === undefined) {
        screensModule.finishTransition(tag, true);
        return;
      }
      event.set(at(0));
      startScreenTransition({
        stackTag: tag,
        topScreenId: top,
        belowTopScreenId: below,
        screenTransition: SWIPE_BACK,
        sharedEvent: event,
        startingGesturePosition: event,
        isTransitionCanceled: false,
        goBackGesture: "swipeRight",
        screenDimensions: { x: 0, y: 0, width, height, pageX: 0, pageY: 0 },
      });
      active.set(true);
      tracking.set(true);
    },
    onUpdate: (update) => {
      if (!tracking.get() || !screensModule) return;
      const x = Math.max(0, update.translationX);
      event.set(at(x));
      screensModule.updateTransition(stackTag.get(), x / width);
    },
    onDeactivate: (end) => {
      if (!tracking.get() || !screensModule) return;
      tracking.set(false);
      const module = screensModule;
      const tag = stackTag.get();
      const x = Math.max(0, end.translationX);
      const back =
        !end.canceled &&
        (end.velocityX > FLICK_VELOCITY ||
          (end.velocityX > -FLICK_VELOCITY && x > width * BACK_FRACTION));
      drive.set(x);
      // The settle callback removes this listener. An unmount cancels the spring in the cleanup
      // of `useSharedValue`, and the callback runs then too. A listener gets each spring frame
      // before the end callback; a mapper such as `useAnimatedReaction` runs after it.
      // react-doctor-disable-next-line react-doctor/effect-needs-cleanup -- the settle removes it.
      drive.addListener(tag, (value) => {
        event.set(at(value));
        module.updateTransition(tag, value / width);
      });
      drive.set(
        withSpring(back ? width : 0, { ...SETTLE, velocity: end.velocityX }, () => {
          drive.removeListener(tag);
          event.removeListener(tag);
          module.finishTransition(tag, !back);
          active.set(false);
        }),
      );
    },
  });

  return <GestureDetector gesture={pan}>{children}</GestureDetector>;
}

/**
 * Gives each native stack the Android swipe back (see `useSwipeBackNativeProps`). iOS keeps its
 * native back swipe, so its stacks get no detector.
 */
export function SwipeBackProvider({ children }: PropsWithChildren): ReactElement {
  if (Platform.OS !== "android") return <>{children}</>;
  return <GHContext.Provider value={GHWrapper}>{children}</GHContext.Provider>;
}
