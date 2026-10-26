import { type BarcodeScanningResult, CameraView, useCameraPermissions } from "expo-camera";
import { Stack, useRouter } from "expo-router";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { Linking, useWindowDimensions, View } from "react-native";
import { AppSystemBars } from "@/ui/app-system-bars";
import { StyleSheet } from "react-native-unistyles";
import { appActivitySource } from "@/host-session/device-sources";
import { Button } from "@/ui/button";
import { haptics } from "@/ui/haptics";
import { Icon } from "@/ui/icon";
import { EmptyState, ErrorState, LoadingState } from "@/ui/states";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { scannedAddress } from "./scanned-address";

const CORNERS = ["topLeft", "topRight", "bottomLeft", "bottomRight"] as const;

/** Rounded corner guides around the area where the QR code goes. */
function Viewfinder(): ReactElement {
  const { width, height } = useWindowDimensions();
  const size = Math.max(160, Math.min(width - 96, height - 320, 280));
  return (
    <View style={[styles.viewfinder, { width: size, height: size }]}>
      {CORNERS.map((corner) => (
        <View key={corner} style={[styles.corner, styles[corner]]} />
      ))}
    </View>
  );
}

/** The close control in the top leading corner. Over the camera it sits on a dark circle. */
function CloseButton({
  overCamera,
  onPress,
}: {
  overCamera: boolean;
  onPress: () => void;
}): ReactElement {
  return (
    <View style={styles.close}>
      <Touchable
        feedback="opacity"
        onPress={onPress}
        radius={18}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Close"
        accessibilityHint="Returns to the host address field."
        style={[styles.closeCircle, overCamera ? styles.closeOverCamera : styles.closePlain]}
      >
        <Icon name="x" size={16} color={overCamera ? "onTint" : "secondaryLabel"} />
      </Touchable>
    </View>
  );
}

/**
 * Scans the QR code that Remote control shows on the host. The code contains only the host
 * address, so the app treats the text as typed input. The camera starts only on this screen.
 */
export function ScanHostScreen(): ReactElement {
  const router = useRouter();
  const [permission, requestPermission, readPermission] = useCameraPermissions();
  // The user can allow the camera in the system settings and come back, so the screen reads the
  // permission again on each return to the app.
  useEffect(
    () =>
      appActivitySource.subscribe((activity) => {
        if (activity === "foreground") void readPermission();
      }),
    [readPermission],
  );
  const [cameraError, setCameraError] = useState<string | null>(null);
  const scanned = useRef(false);
  const close = () => router.back();

  const onScanned = (result: BarcodeScanningResult) => {
    if (scanned.current) return;
    scanned.current = true;
    haptics.success();
    scannedAddress.setState({ value: result.data.trim() });
    router.back();
  };

  const live = permission?.granted === true && cameraError === null;

  let content: ReactElement;
  if (!permission) {
    content = <LoadingState label="Checking camera access" />;
  } else if (!permission.granted) {
    const denied = !permission.canAskAgain;
    content = (
      <EmptyState
        icon={denied ? "camera-off" : "camera"}
        title={denied ? "Camera Access Is Off" : "Allow Camera Access"}
        message={
          denied
            ? "Allow camera access for OpenDucktor in Settings, or type the host address."
            : "OpenDucktor uses the camera only to read the QR code that Remote control shows on the host."
        }
        action={
          <View style={styles.actions}>
            {denied ? (
              <Button label="Open Settings" onPress={() => void Linking.openSettings()} />
            ) : (
              <Button label="Allow Camera" onPress={() => void requestPermission()} />
            )}
            <Button label="Type Address" variant="outline" onPress={close} />
          </View>
        }
      />
    );
  } else if (cameraError !== null) {
    content = (
      <ErrorState
        title="Camera Did Not Start"
        message={`${cameraError} Type the host address instead.`}
        action={<Button label="Type Address" variant="outline" onPress={close} />}
      />
    );
  } else {
    content = (
      <>
        <CameraView
          style={styles.fill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={onScanned}
          onMountError={(event) => setCameraError(event.message)}
          accessibilityLabel="Camera view for the host QR code"
        />
        <View style={styles.overlay}>
          <Viewfinder />
          <View style={styles.hint}>
            <Text variant="headline" style={styles.hintText}>
              Scan the host QR code
            </Text>
            <Text variant="subhead" style={[styles.hintText, styles.hintDetail]}>
              On your computer, open Settings, Remote control, and show the QR code.
            </Text>
          </View>
        </View>
      </>
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      {/* The camera is dark, so the status bar shows light icons over it. */}
      {live ? <AppSystemBars icons="light" /> : null}
      {content}
      <CloseButton overCamera={live} onPress={close} />
    </View>
  );
}

const GUIDE = 34;
const STROKE = 4;
const GUIDE_RADIUS = 22;

const styles = StyleSheet.create((theme, rt) => ({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  fill: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  overlay: {
    pointerEvents: "none",
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.space.xxl,
    paddingHorizontal: theme.space.xxl,
  },
  viewfinder: { position: "relative" },
  corner: {
    position: "absolute",
    width: GUIDE,
    height: GUIDE,
    borderColor: theme.colors.onTint,
  },
  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: STROKE,
    borderLeftWidth: STROKE,
    borderTopLeftRadius: GUIDE_RADIUS,
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: STROKE,
    borderRightWidth: STROKE,
    borderTopRightRadius: GUIDE_RADIUS,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: STROKE,
    borderLeftWidth: STROKE,
    borderBottomLeftRadius: GUIDE_RADIUS,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: STROKE,
    borderRightWidth: STROKE,
    borderBottomRightRadius: GUIDE_RADIUS,
  },
  hint: {
    maxWidth: 320,
    gap: theme.space.xxs,
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.md,
    borderRadius: theme.radius.xl,
    borderCurve: "continuous",
    backgroundColor: theme.colors.scrim,
  },
  hintText: { color: theme.colors.onTint, textAlign: "center" },
  hintDetail: { opacity: 0.8 },
  actions: { flexDirection: "row", gap: theme.space.sm },
  close: {
    position: "absolute",
    top: rt.insets.top + theme.space.sm,
    left: rt.insets.left + theme.space.lg,
  },
  closeCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  closeOverCamera: { backgroundColor: theme.colors.scrim },
  closePlain: { backgroundColor: theme.colors.fill },
}));
