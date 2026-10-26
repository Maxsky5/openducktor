import { type NativeStackNavigationOptions, Stack, useRouter } from "expo-router";
import {
  type ComponentRef,
  type PropsWithChildren,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import { IconButton } from "@/ui/icon-button";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { SheetCloseContext } from "./sheet-close";
import { useBlockBack } from "./use-block-back";

export type SheetScreenProps = PropsWithChildren<{
  title: string;
  /** Closes the sheet. The default goes back. */
  onClose?: (() => void) | undefined;
  /** The close control label on iOS: "Cancel" for a form, "Done" for a viewer. */
  closeLabel?: "Cancel" | "Done" | undefined;
  /**
   * False while an action runs, so the close control, the swipe down, and Android Back cannot
   * close the sheet.
   */
  closable?: boolean | undefined;
  /** `sheet` is the white surface of a desktop dialog. */
  background?: "plain" | "grouped" | "sheet" | undefined;
  /**
   * True for a sheet that a drag down closes, so Android shows its drag handle. Full-height forms
   * are full-screen dialogs on Android, without a handle.
   */
  draggable?: boolean | undefined;
}>;

function TextAction({
  label,
  onPress,
  disabled = false,
  emphasized = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  emphasized?: boolean;
}): ReactElement {
  return (
    <Touchable
      feedback="opacity"
      onPress={onPress}
      disabled={disabled}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
    >
      <Text variant={emphasized ? "headline" : "body"} tone="tint">
        {label}
      </Text>
    </Touchable>
  );
}

/**
 * The frame of a route sheet. iOS puts the title and the close control in the native navigation
 * bar of the form sheet. Android sheets have no navigation bar, so the frame draws a Material
 * header: the drag handle of a draggable sheet, the title, and a close control. A form footer in
 * the sheet takes the close control as its Cancel button (see `useSheetClose`), and the header
 * then shows only the title.
 */
export function SheetScreen({
  title,
  onClose,
  closeLabel = "Cancel",
  closable = true,
  background = "sheet",
  draggable = false,
  children,
}: SheetScreenProps): ReactElement {
  const router = useRouter();
  // The close control calls the latest handler, so the screen options change only when the
  // header shows something new. Each new options object renders the whole navigator again.
  const closeHandler = useRef(onClose);
  useEffect(() => {
    closeHandler.current = onClose;
  });
  const close = useCallback(() => {
    const handler = closeHandler.current;
    if (handler) handler();
    else router.back();
  }, [router]);
  const [footers, setFooters] = useState(0);
  const claimFooter = useCallback(() => {
    setFooters((count) => count + 1);
    return () => setFooters((count) => count - 1);
  }, []);
  const sheetClose = useMemo(
    () => ({ close, closable, claimFooter }),
    [claimFooter, closable, close],
  );
  const headerClose = footers === 0;
  const options = useMemo<NativeStackNavigationOptions>(() => {
    if (Platform.OS !== "ios") return { title, gestureEnabled: closable };
    if (!headerClose) {
      return {
        title,
        headerShown: true,
        gestureEnabled: closable,
        headerLeft: () => null,
        headerRight: () => null,
      };
    }
    // A viewer closes with Done on the trailing side, as UIKit sheets do.
    if (closeLabel === "Done") {
      return {
        title,
        headerShown: true,
        gestureEnabled: closable,
        headerLeft: () => null,
        headerRight: () => (
          <TextAction label="Done" onPress={close} disabled={!closable} emphasized />
        ),
      };
    }
    return {
      title,
      headerShown: true,
      gestureEnabled: closable,
      headerLeft: () => <TextAction label={closeLabel} onPress={close} disabled={!closable} />,
      headerRight: () => null,
    };
  }, [closable, close, closeLabel, headerClose, title]);
  useBlockBack(!closable);
  styles.useVariants({ background });
  if (Platform.OS === "ios") {
    return (
      <SheetCloseContext value={sheetClose}>
        <View style={styles.root}>
          <Stack.Screen options={options} />
          {children}
        </View>
      </SheetCloseContext>
    );
  }
  return (
    <SheetCloseContext value={sheetClose}>
      <AndroidSheetFrame background={background}>
        <Stack.Screen options={options} />
        {draggable ? <View style={styles.handle} /> : null}
        <View style={styles.header}>
          <Text variant="title2" accessibilityRole="header" numberOfLines={1} style={styles.title}>
            {title}
          </Text>
          {headerClose ? (
            <IconButton
              icon="x"
              variant="filled"
              accessibilityLabel="Close"
              onPress={close}
              disabled={!closable}
            />
          ) : null}
        </View>
        {children}
      </AndroidSheetFrame>
    </SheetCloseContext>
  );
}

/**
 * A full-height Android form sheet can reach under the status bar. The frame measures its top on
 * the screen and moves its content below the status bar when needed.
 */
function AndroidSheetFrame({
  background,
  children,
}: PropsWithChildren<{ background: "plain" | "grouped" | "sheet" }>): ReactElement {
  styles.useVariants({ background });
  const frame = useRef<ComponentRef<typeof View>>(null);
  const insets = useSafeAreaInsets();
  const [statusBarOverlap, setStatusBarOverlap] = useState(0);
  return (
    <View
      ref={frame}
      style={[styles.root, { paddingTop: statusBarOverlap }]}
      onLayout={() =>
        frame.current?.measureInWindow((_x, y) =>
          setStatusBarOverlap(Math.max(0, Math.round(insets.top - y))),
        )
      }
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    variants: {
      background: {
        plain: { backgroundColor: theme.colors.background },
        grouped: { backgroundColor: theme.colors.groupedBackground },
        sheet: { backgroundColor: theme.desktop.popover },
      },
    },
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 5,
    borderRadius: 3,
    marginTop: theme.space.sm,
    backgroundColor: theme.colors.fillStrong,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.md,
    minHeight: 60,
    paddingLeft: theme.space.xl,
    paddingRight: theme.space.lg,
  },
  title: { flex: 1 },
}));
