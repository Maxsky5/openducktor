import {
  completesPairingCode,
  isPairingCode,
} from "@openducktor/frontend-core/lib/pairing-code-selection";
import { useSingleFlight } from "@openducktor/frontend-core/lib/use-single-flight";
import {
  describeRemoteConnectionFailure,
  type RemoteConnectionFailure,
} from "@openducktor/frontend-core/lib/remote-connection-failure";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { StyleSheet } from "react-native-unistyles";
import { useRouter } from "expo-router";
import { routes } from "@/navigation/routes";
import { Button } from "@/ui/button";
import { PairingCodeInput } from "@/hosts/pairing-code-input";
import { RemoteNetworkNotice } from "@/hosts/remote-network-notice";
import { useFeedbackStore } from "@/app-shell/app-services";
import { Callout } from "@/ui/callout";
import { Text } from "@/ui/text";
import { useActiveSession } from "./active-session-context";

export function HostPairingForm() {
  const {
    host,
    remote: { remote },
  } = useActiveSession();
  const router = useRouter();
  const { feedback } = useFeedbackStore();
  const state = useSyncExternalStore(remote.subscribeState, remote.readState, remote.readState);
  const stateFailure =
    state.failure?.code === "pairing_refused"
      ? { message: state.failure.message, nextAction: state.failure.nextAction, pairing: true }
      : null;
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<RemoteConnectionFailure | null>(null);
  const attempt = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      if (["connecting", "synchronizing"].includes(remote.readState().status))
        attempt.current?.abort();
    },
    [remote],
  );
  // The sixth digit and the keyboard Go key can both submit before React renders the pending state.
  const flight = useSingleFlight();
  const connect = (pairingCode = code) =>
    flight.start(async () => {
      if (!isPairingCode(pairingCode)) return;
      const abort = new AbortController();
      attempt.current = abort;
      setPending(true);
      try {
        await remote.connect({ pairingCode, signal: abort.signal });
        if (!abort.signal.aborted)
          feedback.show("success", "Connected to host", { description: host.label });
      } catch (cause) {
        // The last failure stays until this one replaces it, so the form does not flicker.
        if (!abort.signal.aborted) setError(describeRemoteConnectionFailure(cause));
      }
      setPending(false);
    });
  const failure = error ?? stateFailure;
  return (
    <KeyboardAwareScrollView
      keyboardShouldPersistTaps="handled"
      bottomOffset={160}
      contentContainerStyle={styles.page}
    >
      <View style={styles.form}>
        <Text variant="title2" accessibilityRole="header">
          Pair with host
        </Text>
        <Text variant="subhead" tone="secondary">
          This device needs a new code to connect to your host.
        </Text>
        <View style={styles.destination}>
          <Text variant="footnote" tone="tertiary">
            Connecting to
          </Text>
          <Text variant="monoSmall" selectable>
            {host.endpoint}
          </Text>
        </View>
        <Text variant="subhead" tone="secondary">
          On your computer, open Remote control and select Add device.
        </Text>
        <PairingCodeInput
          value={code}
          onChange={(next) => {
            setCode(next);
            setError(null);
            // Typing the sixth digit connects. A changed digit of a full code waits for Connect.
            if (completesPairingCode(code, next)) void connect(next);
          }}
          disabled={pending}
          invalid={failure !== null}
          hint={failure ? failure.message : undefined}
          onSubmit={() => void connect()}
        />
        {failure ? (
          <Callout tone="destructive" title={failure.message} detail={failure.nextAction} />
        ) : null}
        <View style={styles.actions}>
          <Button
            label={pending ? "Connecting..." : "Connect"}
            loading={pending}
            disabled={pending || !isPairingCode(code)}
            onPress={() => void connect()}
            size="lg"
            fill
          />
          <Button
            label="Cancel"
            variant="outline"
            size="lg"
            fill
            onPress={() => {
              attempt.current?.abort();
              void remote.disconnect().then(() => router.push(routes.hosts()));
            }}
          />
        </View>
        <RemoteNetworkNotice endpoint={host.endpoint} />
      </View>
    </KeyboardAwareScrollView>
  );
}
const styles = StyleSheet.create((theme) => ({
  page: { flexGrow: 1, justifyContent: "center", padding: theme.layout.screenPadding },
  form: {
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    padding: theme.space.xl,
    gap: theme.space.lg,
    borderWidth: 1,
    borderColor: theme.desktop.border,
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.surface,
  },
  destination: {
    gap: theme.space.xs,
    padding: theme.space.md,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.insetFill,
  },
  actions: { gap: theme.space.sm },
}));
