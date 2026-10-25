import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { useSingleFlight } from "@openducktor/frontend-core/lib/use-single-flight";
import { useFocusEffect } from "expo-router";
import {
  type ComponentRef,
  type ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { type TextInput, View } from "react-native";
import { useKeyboardState } from "react-native-keyboard-controller";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { useHostSessionOwner } from "@/app-shell/app-services";
import { AddHostError, DraftSaveBeforeSwitchError } from "@/host-session/host-session-owner";
import { useConfirmDraftLoss } from "./confirm-draft-loss";
import { useAppTheme } from "@/theme/app-theme-context";
import { withAlpha } from "@/theme/color-alpha";
import { Button } from "@/ui/button";
import { TextField } from "@/ui/fields";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { useShake } from "@/ui/use-shake";
import { takeScannedAddress } from "./scanned-address";

const FOLD_IN = FadeIn.duration(200);
const FOLD_OUT = FadeOut.duration(120);
const SETTLE = LinearTransition.duration(220);

/** The desktop host picker help, for a phone that cannot copy from the host. */
const ADDRESS_HINT = "Find the address in Settings, Remote control on the host.";

const isPlainHttp = (value: string) => /^\s*http:\/\//i.test(value);

/**
 * The fast way in: Remote control on the host shows a QR code with its address. The card is the
 * desktop launcher card (`session-panel-launcher.tsx`) in its active colors.
 */
function ScanCard({ onPress, disabled }: { onPress: () => void; disabled: boolean }): ReactElement {
  const theme = useAppTheme();
  return (
    <Touchable
      feedback="scale"
      onPress={onPress}
      disabled={disabled}
      radius={theme.radius.xl}
      accessibilityRole="button"
      accessibilityLabel="Scan QR Code"
      accessibilityHint="Opens the camera to scan the code that Remote control shows on the host."
      style={styles.scan}
    >
      <View style={styles.scanTile}>
        <Icon name="qr-code" size={20} colorValue={theme.desktop.selectedAccent} />
      </View>
      <View style={styles.scanText}>
        <Text weight="medium">Scan QR Code</Text>
        <Text variant="subhead" tone="tertiary">
          On your computer, open Settings, Remote control, and show the QR code.
        </Text>
      </View>
      <Icon name="arrow-right" size={16} color="tertiaryLabel" />
    </Touchable>
  );
}

/** A line with a label in its middle, between two ways to do one thing. */
function OrDivider({ label }: { label: string }): ReactElement {
  return (
    <View style={styles.divider} accessible={false}>
      <View style={styles.dividerLine} />
      <Text variant="footnote" weight="medium" tone="tertiary">
        {label}
      </Text>
      <View style={styles.dividerLine} />
    </View>
  );
}

/**
 * Adds a host: scan its QR code, or type its address, and give it a name. The host is saved only
 * after discovery and negotiation succeed. A failure keeps the input, shakes the fields, and
 * shows the host reason with its next action.
 */
export function AddHostForm({ onScan }: { onScan: () => void }): ReactElement {
  const owner = useHostSessionOwner();
  const confirmDraftLoss = useConfirmDraftLoss();
  const [address, setAddress] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<{ message: string; nextAction: string | null } | null>(null);
  const [connecting, setConnecting] = useState(false);
  const attempt = useRef<AbortController | null>(null);
  // One attempt at a time, so a double tap does not replace the attempt that Cancel stops.
  const connectFlight = useSingleFlight();
  const nameField = useRef<ComponentRef<typeof TextInput>>(null);
  const shake = useShake();
  // While the keyboard shows, the sheet keeps only the fields and Connect, so Connect stays above it.
  const typing = useKeyboardState((state) => state.isVisible);

  // A sheet that the user closes cancels its attempt, so the app does not switch to that host later.
  useEffect(() => () => attempt.current?.abort(new Error("The user closed Add Host.")), []);

  useFocusEffect(
    useCallback(() => {
      const scanned = takeScannedAddress();
      if (scanned !== null) {
        setAddress(scanned);
        setError(null);
        nameField.current?.focus();
      }
    }, []),
  );

  const attemptConnect = async (discardUnsavedDrafts: boolean): Promise<void> => {
    const controller = new AbortController();
    attempt.current = controller;
    setConnecting(true);
    setError(null);
    try {
      await owner.addHost(address, {
        signal: controller.signal,
        discardUnsavedDrafts,
        label: name,
      });
    } catch (cause) {
      if (controller.signal.aborted) return;
      if (cause instanceof DraftSaveBeforeSwitchError) {
        const proceed = await confirmDraftLoss(cause);
        if (proceed) await attemptConnect(true);
        return;
      }
      setError(
        cause instanceof AddHostError && cause.failure
          ? { message: cause.failure.message, nextAction: cause.failure.nextAction }
          : { message: errorMessage(cause), nextAction: null },
      );
      shake.shake();
    } finally {
      if (attempt.current === controller) attempt.current = null;
      setConnecting(false);
    }
  };
  const connect = async (): Promise<void> => {
    await connectFlight.start(() => attemptConnect(false));
  };

  const cancel = () => {
    attempt.current?.abort(new Error("The user canceled the connection."));
  };

  const canConnect = address.trim().length > 0 && !connecting;

  return (
    <View style={styles.form}>
      {typing ? null : (
        <Animated.View entering={FOLD_IN} exiting={FOLD_OUT} style={styles.scanGroup}>
          <ScanCard onPress={onScan} disabled={connecting} />
          <OrDivider label="or enter the address" />
        </Animated.View>
      )}
      <Animated.View layout={SETTLE} style={[styles.fields, shake.style]}>
        <TextField
          label="Host address"
          value={address}
          onChangeText={(next) => {
            setAddress(next);
            setError(null);
          }}
          placeholder="http://192.168.1.20:52959"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          keyboardType="url"
          textContentType="URL"
          returnKeyType="next"
          editable={!connecting}
          onSubmitEditing={() => nameField.current?.focus()}
          submitBehavior="submit"
          error={error?.message}
          warning={
            isPlainHttp(address) ? "Plain HTTP is not encrypted. Use a protected network." : null
          }
          hint={error ? error.nextAction : typing ? null : ADDRESS_HINT}
          mono
        />
        <TextField
          inputRef={nameField}
          label="Name (optional)"
          value={name}
          onChangeText={setName}
          placeholder="Studio Mac"
          autoCapitalize="words"
          returnKeyType="go"
          editable={!connecting}
          onSubmitEditing={() => {
            if (canConnect) void connect();
          }}
          hint={
            typing ? null : "Shown in the host list. Without a name, the host shows its address."
          }
        />
      </Animated.View>
      <Animated.View layout={SETTLE} style={styles.actions}>
        <Button
          label={connecting ? "Connecting…" : "Connect to host"}
          size="lg"
          loading={connecting}
          disabled={!canConnect && !connecting}
          onPress={() => void connect()}
          fill
        />
        {connecting ? (
          <Button label="Cancel" variant="outline" size="lg" onPress={cancel} fill />
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  form: { gap: theme.space.lg },
  scanGroup: { gap: theme.space.lg },
  scan: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
    paddingLeft: 14,
    paddingRight: theme.space.lg,
    borderRadius: theme.radius.xl,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: withAlpha(theme.desktop.selectedAccent, 0.4),
    backgroundColor: withAlpha(theme.desktop.muted, 0.2),
  },
  scanTile: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: withAlpha(theme.desktop.selectedAccent, 0.3),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.desktop.muted,
  },
  scanText: { flex: 1, minWidth: 0, gap: 2 },
  divider: { flexDirection: "row", alignItems: "center", gap: theme.space.md },
  dividerLine: { flex: 1, height: theme.hairline, backgroundColor: theme.desktop.border },
  fields: { gap: theme.space.lg },
  actions: { gap: theme.space.sm, paddingTop: theme.space.xs },
}));
