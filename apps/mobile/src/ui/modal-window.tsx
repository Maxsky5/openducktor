import { memo, type ReactElement, useMemo } from "react";
import { Modal, type ModalProps, Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { FadeIn, FadeOut, ReduceMotion } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { scheduleOnRN } from "react-native-worklets";
import { ModalFeedbackHost } from "@/feedback/feedback-host";
import { motion } from "@/theme/tokens";
import { useModalPresence } from "./use-modal-presence";

type ModalWindowProps = Omit<ModalProps, "visible" | "onShow"> & {
  visible: boolean;
  onShow?: (() => void) | undefined;
};

/** Uses native iOS presentation and a short UI-thread fade in an Android window. */
export function ModalWindow(props: ModalWindowProps): ReactElement {
  if (Platform.OS !== "ios") return <AndroidModalWindow {...props} />;
  return (
    <Modal {...props}>
      <GestureHandlerRootView style={styles.fill}>
        <ModalContent visible={props.visible}>{props.children}</ModalContent>
        {props.visible ? <ModalFeedbackHost /> : null}
      </GestureHandlerRootView>
    </Modal>
  );
}

function AndroidModalWindow({
  visible,
  onShow,
  onDismiss,
  children,
  ...props
}: ModalWindowProps): ReactElement {
  const { mounted, cycle, entered, exited } = useModalPresence(visible, { onShow, onDismiss });
  const entering = useMemo(
    () =>
      FadeIn.duration(motion.base)
        .easing(motion.easeOutCurve)
        .reduceMotion(ReduceMotion.System)
        .withCallback((finished) => {
          "worklet";
          if (finished) scheduleOnRN(entered, cycle);
        }),
    [cycle, entered],
  );
  const exiting = useMemo(
    () =>
      FadeOut.duration(motion.fast)
        .easing(motion.easeOutCurve)
        .reduceMotion(ReduceMotion.System)
        .withCallback((finished) => {
          "worklet";
          if (finished) scheduleOnRN(exited, cycle);
        }),
    [cycle, exited],
  );
  return (
    <Modal {...props} visible={mounted} animationType="none">
      <GestureHandlerRootView style={styles.fill}>
        {/* Android drops a hidden Modal's views before its window closes. Keep the window until
            Reanimated has faded the last native content, including a form the caller has cleared. */}
        {visible ? (
          <Animated.View
            key={cycle}
            collapsable={false}
            entering={entering}
            exiting={exiting}
            style={styles.fill}
          >
            {children}
          </Animated.View>
        ) : null}
        {visible ? <ModalFeedbackHost /> : null}
      </GestureHandlerRootView>
    </Modal>
  );
}

// Keep closing content without keeping its toast host, so new toasts go to the screen below.
const ModalContent = memo(
  function ModalContent({ children }: Pick<ModalWindowProps, "visible" | "children">) {
    return <>{children}</>;
  },
  (_previous, next) => !next.visible,
);

const styles = StyleSheet.create({ fill: { flex: 1 } });
