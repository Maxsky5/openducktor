import { Image } from "expo-image";
import { useRouter } from "expo-router";
import type { ReactElement } from "react";
import { View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import { useHostSessionState } from "@/app-shell/app-services";
import { useAppTheme } from "@/theme/app-theme-context";
import { AppVersionFooter } from "@/ui/settings-layout";
import { ThemeMenuButton } from "@/features/settings/theme-menu-button";
import { AddHostForm } from "@/hosts/add-host-form";
import { SavedHostsList } from "@/hosts/saved-hosts-list";
import { routes } from "@/navigation/routes";
import { appVersionLabel } from "@/platform/app-version";
import { withAlpha } from "@/theme/color-alpha";
import { PlainScreen } from "@/ui/screen";
import { Text } from "@/ui/text";

const APP_ICON = require("../../../assets/images/icon.png");
const APP_VERSION = appVersionLabel();

/** The desktop page header: the OpenDucktor mark and name, and the theme control. */
function BrandHeader(): ReactElement {
  return (
    <View style={styles.header}>
      <View style={styles.brand}>
        <Image
          source={APP_ICON}
          style={styles.mark}
          contentFit="cover"
          accessible={false}
          accessibilityIgnoresInvertColors
        />
        <Text variant="headline" style={styles.brandName}>
          OpenDucktor
        </Text>
      </View>
      <ThemeMenuButton />
    </View>
  );
}

/**
 * The first screen without an active host, as the desktop host connection page: the brand
 * header, one card that adds a host, the saved hosts, and the app version.
 */
export default function SetupScreen(): ReactElement {
  const router = useRouter();
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const state = useHostSessionState();
  const hosts = state.status === "no_host" ? state.hosts : [];
  const damagedHosts = state.status === "no_host" ? state.damagedHosts : [];
  return (
    <PlainScreen>
      <KeyboardAwareScrollView
        keyboardShouldPersistTaps="handled"
        // Keeps Connect above the keyboard while a field has focus.
        bottomOffset={120}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + theme.space.md,
            paddingBottom: insets.bottom + theme.space.xxl,
          },
        ]}
      >
        <BrandHeader />
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text
              variant="title1"
              weight="semibold"
              accessibilityRole="header"
              style={styles.title}
            >
              Connect to a host
            </Text>
            <Text variant="callout" style={styles.description}>
              Follow and control the agents that run on your computer.
            </Text>
          </View>
          <View style={styles.cardContent}>
            <AddHostForm onScan={() => router.push(routes.setupScan())} />
          </View>
        </View>
        {hosts.length > 0 || damagedHosts.length > 0 ? (
          <SavedHostsList hosts={hosts} damagedHosts={damagedHosts} activeHostId={null} />
        ) : null}
        <AppVersionFooter version={APP_VERSION} />
      </KeyboardAwareScrollView>
    </PlainScreen>
  );
}

const MARK = 32;

const styles = StyleSheet.create((theme) => ({
  content: {
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    gap: 28,
    paddingHorizontal: theme.layout.screenPadding,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.space.lg,
    paddingHorizontal: theme.space.xs,
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  mark: {
    width: MARK,
    height: MARK,
    borderRadius: theme.radius.sm,
    borderCurve: "continuous",
  },
  brandName: { fontSize: 16, letterSpacing: -0.3 },
  card: {
    borderWidth: 1,
    borderColor: theme.desktop.border,
    borderRadius: theme.radius.xl,
    borderCurve: "continuous",
    backgroundColor: theme.desktop.card,
    boxShadow: theme.shadows.card,
  },
  cardHeader: { gap: theme.space.md, paddingHorizontal: theme.space.xl, paddingTop: 28 },
  title: { letterSpacing: -0.5 },
  description: { color: withAlpha(theme.desktop.foreground, 0.7), lineHeight: 22 },
  cardContent: {
    paddingHorizontal: theme.space.xl,
    paddingTop: theme.space.xxl,
    paddingBottom: 28,
  },
}));
