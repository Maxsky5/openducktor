import type { JSONType } from "zod";
import { isRemotePairingFailure } from "@openducktor/host-client/remote";
import { remotePairingQrSchema } from "@openducktor/contracts";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import {
  completesPairingCode,
  isPairingCode,
} from "@openducktor/frontend-core/lib/pairing-code-selection";
import { useSingleFlight } from "@openducktor/frontend-core/lib/use-single-flight";
import { useFocusEffect } from "expo-router";
import { type ReactElement, useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useKeyboardState } from "react-native-keyboard-controller";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { useFeedbackStore, useHostSessionOwner } from "@/app-shell/app-services";
import { AddHostError, DraftSaveBeforeSwitchError } from "@/host-session/host-session-owner";
import { useConfirmDraftLoss } from "./confirm-draft-loss";
import { useAppTheme } from "@/theme/app-theme-context";
import { withAlpha } from "@/theme/color-alpha";
import { Button } from "@/ui/button";
import { Callout } from "@/ui/callout";
import { TextField } from "@/ui/fields";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { useShake } from "@/ui/use-shake";
import { PairingCodeInput } from "./pairing-code-input";
import { RemoteNetworkNotice } from "./remote-network-notice";
import { takeScannedAddress } from "./scanned-address";

const FOLD_IN = FadeIn.duration(200);
const FOLD_OUT = FadeOut.duration(120);
const SETTLE = LinearTransition.duration(220);

type ConnectionFailure = {
  message: string;
  nextAction: string | null;
};

/** The desktop host picker help, for a phone that cannot copy from the host. */
const ADDRESS_HINT =
  "On your computer, open Remote control and select Add device. It shows the address.";

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
      accessibilityLabel="Scan QR code"
      accessibilityHint="Opens the camera to scan the code that Remote control shows on the host."
      style={styles.scan}
    >
      <View style={styles.scanTile}>
        <Icon name="qr-code" size={20} colorValue={theme.desktop.selectedAccent} />
      </View>
      <View style={styles.scanText}>
        <Text weight="medium">Scan QR code</Text>
        <Text variant="subhead" tone="tertiary">
          On your computer, open Remote control, select Add device, then Scan a QR code.
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
 * Adds a host with its pairing QR code or address and code. The host is saved only
 * after discovery and negotiation succeed. A failure keeps the input, shakes the fields, and
 * shows the host reason with its next action.
 */
export function AddHostForm({ onScan }: { onScan: () => void }): ReactElement {
  const owner = useHostSessionOwner();
  const confirmDraftLoss = useConfirmDraftLoss();
  const { feedback } = useFeedbackStore();
  const [pairingRequested, setPairingRequested] = useState(false);
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<ConnectionFailure | null>(null);
  const [connecting, setConnecting] = useState(false);
  const attempt = useRef<AbortController | null>(null);
  // One attempt at a time, so a double tap does not replace the attempt that Cancel stops.
  const connectFlight = useSingleFlight();
  const { shake, style: shakeStyle } = useShake();
  // While the keyboard shows, the sheet keeps only the fields and Connect, so Connect stays above it.
  const typing = useKeyboardState((state) => state.isVisible);

  // A sheet that the user closes cancels its attempt, so the app does not switch to that host later.
  // The switch itself also unmounts the sheet once the old session closes. That unmount is part of
  // the switch and does not cancel it; a cancel then would leave the app with no host.
  useEffect(
    () => () => {
      if (owner.getState().status === "switching") return;
      attempt.current?.abort(new Error("The user closed Add Host."));
    },
    [owner],
  );

  const attemptConnect = useCallback(
    // The callers pass the address and code, so a keystroke does not renew the scan effect below.
    async (targetAddress: string, pairingCode: string): Promise<void> => {
      const controller = new AbortController();
      attempt.current = controller;
      setConnecting(true);
      try {
        const input: NonNullable<Parameters<typeof owner.addHost>[1]> = {
          signal: controller.signal,
          confirmDraftLoss,
        };
        if (pairingCode) input.pairingCode = pairingCode.trim();
        const result = await owner.addHost(targetAddress, input);
        if (result.kind !== "moved")
          feedback.show("success", "Connected to host", { description: result.host.label });
      } catch (cause) {
        // A cancel or a kept draft is the user's choice, not a failure.
        const shown = !controller.signal.aborted && !(cause instanceof DraftSaveBeforeSwitchError);
        const failure = cause instanceof AddHostError ? cause.failure : undefined;
        if (shown && failure?.code === "authorization_required") {
          // A request for a code is the next step, not a failure.
          setError(null);
          setPairingRequested(true);
        } else if (shown) {
          if (failure && isRemotePairingFailure(failure.code)) setPairingRequested(true);
          setError(
            failure
              ? { message: failure.message, nextAction: failure.nextAction }
              : { message: errorMessage(cause), nextAction: null },
          );
          shake();
        }
      }
      // The catch handles every failure, so this cleanup runs after each attempt.
      if (attempt.current === controller) attempt.current = null;
      setConnecting(false);
    },
    [owner, confirmDraftLoss, shake, feedback],
  );
  const canConnect =
    address.trim().length > 0 && (!pairingRequested || isPairingCode(code)) && !connecting;

  const connect = async (): Promise<void> => {
    if (!canConnect) return;
    await connectFlight.start(() => attemptConnect(address, code));
  };

  useFocusEffect(
    useCallback(() => {
      const scanned = takeScannedAddress();
      if (scanned === null) return;
      let value: JSONType;
      try {
        value = JSON.parse(scanned);
      } catch {
        value = null;
      }
      const pairing = remotePairingQrSchema.safeParse(value);
      if (pairing.success) {
        setAddress(pairing.data.endpoint);
        setCode(pairing.data.code);
        setPairingRequested(true);
        setError(null);
        void connectFlight.start(() => attemptConnect(pairing.data.endpoint, pairing.data.code));
      } else {
        setPairingRequested(false);
        setAddress(scanned);
        setCode("");
        setError(null);
      }
    }, [connectFlight, attemptConnect]),
  );

  const cancel = () => {
    attempt.current?.abort(new Error("The user canceled the connection."));
  };

  let submitLabel = pairingRequested ? "Connect to host" : "Continue";
  if (connecting) submitLabel = "Connecting…";
  return (
    <View style={styles.form}>
      {typing || pairingRequested ? null : (
        <Animated.View entering={FOLD_IN} exiting={FOLD_OUT} style={styles.scanGroup}>
          <ScanCard onPress={onScan} disabled={connecting} />
          <OrDivider label="or enter the address" />
        </Animated.View>
      )}
      <Animated.View layout={SETTLE} style={[styles.fields, shakeStyle]}>
        {pairingRequested ? (
          <PairingStep
            address={address}
            code={code}
            error={error}
            disabled={connecting}
            onChangeAddress={() => {
              setPairingRequested(false);
              setCode("");
              setError(null);
            }}
            onCodeChange={(next) => {
              setCode(next);
              setError(null);
              // Typing the sixth digit connects. A changed digit of a full code waits for Connect.
              if (completesPairingCode(code, next))
                void connectFlight.start(() => attemptConnect(address, next));
            }}
            onSubmit={() => void connect()}
          />
        ) : (
          <HostAddressStep
            address={address}
            error={error}
            disabled={connecting}
            typing={typing}
            onChange={(next) => {
              setAddress(next);
              setError(null);
            }}
            onSubmit={() => void connect()}
          />
        )}
      </Animated.View>
      <Animated.View layout={SETTLE} style={styles.actions}>
        {connecting ? (
          <Button
            label="Cancel"
            variant="outline"
            size="lg"
            onPress={cancel}
            fill
            style={styles.action}
          />
        ) : null}
        <Button
          label={submitLabel}
          icon="server"
          size="lg"
          loading={connecting}
          disabled={!canConnect && !connecting}
          onPress={() => void connect()}
          fill
          style={styles.action}
        />
      </Animated.View>
      <RemoteNetworkNotice endpoint={address} />
    </View>
  );
}

function PairingStep({
  address,
  code,
  error,
  disabled,
  onChangeAddress,
  onCodeChange,
  onSubmit,
}: {
  address: string;
  code: string;
  error: ConnectionFailure | null;
  disabled: boolean;
  onChangeAddress(): void;
  onCodeChange(value: string): void;
  onSubmit(): void;
}) {
  return (
    <>
      <View style={styles.destination}>
        <View style={styles.scanText}>
          <Text variant="footnote" tone="tertiary">
            Connecting to
          </Text>
          <Text variant="monoSmall" selectable>
            {address}
          </Text>
        </View>
        <Button
          label="Change"
          variant="plain"
          size="sm"
          disabled={disabled}
          onPress={onChangeAddress}
        />
      </View>
      <View style={styles.fields}>
        <Text variant="subhead" tone="secondary">
          Enter the code that Add device shows on your computer.
        </Text>
        <PairingCodeInput
          value={code}
          onChange={onCodeChange}
          disabled={disabled}
          invalid={error !== null}
          hint={error?.message}
          onSubmit={onSubmit}
        />
        {error ? (
          <Callout tone="destructive" title={error.message} detail={error.nextAction} />
        ) : null}
      </View>
    </>
  );
}

function HostAddressStep({
  address,
  error,
  disabled,
  typing,
  onChange,
  onSubmit,
}: {
  address: string;
  error: ConnectionFailure | null;
  disabled: boolean;
  typing: boolean;
  onChange(value: string): void;
  onSubmit(): void;
}) {
  return (
    <TextField
      label="Host address"
      value={address}
      onChangeText={onChange}
      placeholder="http://192.168.1.20:14328"
      autoCapitalize="none"
      autoCorrect={false}
      spellCheck={false}
      keyboardType="url"
      textContentType="URL"
      returnKeyType="go"
      editable={!disabled}
      onSubmitEditing={onSubmit}
      error={error?.message}
      hint={error ? error.nextAction : typing ? null : ADDRESS_HINT}
      mono
    />
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
  destination: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.insetFill,
    padding: theme.space.md,
  },
  actions: { flexDirection: "row", gap: theme.space.sm, paddingTop: theme.space.xs },
  action: { flex: 1, flexBasis: 0, minWidth: 0 },
}));
