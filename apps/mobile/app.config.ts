import type { ExpoConfig } from "expo/config";
import { version as packageVersion } from "./package.json";

// The store version follows the repository release version. `scripts/release-version.ts` writes
// the numeric base version to package.json. CI sets a build number that always increases.
const buildNumber = process.env.OPENDUCKTOR_MOBILE_BUILD_NUMBER ?? "1";
if (!/^[1-9]\d*$/.test(buildNumber)) {
  throw new Error(
    `OPENDUCKTOR_MOBILE_BUILD_NUMBER must be a positive whole number. It is "${buildNumber}".`,
  );
}

const CAMERA_REASON =
  "OpenDucktor uses the camera only to scan the QR code that a host shows in Remote control.";
const LOCAL_NETWORK_REASON =
  "OpenDucktor connects to the OpenDucktor hosts that you add on your local or protected network.";
// The app never asks for photo library read or microphone access. The linked camera and image
// picker code still calls their permission APIs, and App Store Connect can reject a build without
// their reasons. Save Image in the share sheet asks for Photos add access, and iOS ends an app that
// has no reason for that write.
const PHOTOS_READ_REASON = "OpenDucktor reads only the photos that you pick to attach.";
const PHOTOS_ADD_REASON =
  "OpenDucktor saves an image to Photos only when you choose Save Image in the share sheet.";
const MICROPHONE_REASON =
  "OpenDucktor never records audio. It uses the camera only to scan a host QR code.";

/**
 * The native window and splash backgrounds and the Android system accent. They match the screen
 * background and tint of `src/theme/colors.ts`, so no frame of another color shows behind a screen.
 * `src/theme/native-colors.test.ts` checks them.
 */
const NATIVE_COLORS = {
  light: { background: "#f1f5f9", accent: "#5100ff" },
  dark: { background: "#0a101e", accent: "#a684ff" },
};

const googleFont = (family: string, file: string, style: string, weight: number) => ({
  path: `./node_modules/@expo-google-fonts/${family}/${style}/${file}_${style}.ttf`,
  weight,
});

/** The desktop fonts: Space Grotesk for text and IBM Plex Mono for code. */
const SANS_FONTS = [
  googleFont("space-grotesk", "SpaceGrotesk", "400Regular", 400),
  googleFont("space-grotesk", "SpaceGrotesk", "500Medium", 500),
  googleFont("space-grotesk", "SpaceGrotesk", "600SemiBold", 600),
  googleFont("space-grotesk", "SpaceGrotesk", "700Bold", 700),
];
const MONO_FONTS = [
  googleFont("ibm-plex-mono", "IBMPlexMono", "400Regular", 400),
  googleFont("ibm-plex-mono", "IBMPlexMono", "500Medium", 500),
  googleFont("ibm-plex-mono", "IBMPlexMono", "600SemiBold", 600),
];
const LUCIDE_FONT = { path: "./node_modules/lucide-static/font/lucide.ttf", weight: 400 };

/**
 * Release builds shrink code with R8 in full mode. expo-camera finds ML Kit barcode scanning by
 * its class name, and ML Kit creates its component registrars by reflection; without these rules
 * the QR scanner never starts.
 */
const ANDROID_PROGUARD_RULES = [
  "-keep class com.google.mlkit.vision.barcode.BarcodeScanning",
  "-keep class * implements com.google.firebase.components.ComponentRegistrar { <init>(); }",
].join("\n");

const config: ExpoConfig = {
  name: "OpenDucktor",
  slug: "openducktor",
  version: packageVersion,
  // Expo Router needs a scheme. The app has no external deep links. `src/app/+native-intent.tsx`
  // opens the start screen for a launch URL and ignores a URL while the app runs.
  scheme: "openducktor",
  orientation: "default",
  userInterfaceStyle: "automatic",
  icon: "./assets/images/icon.png",
  backgroundColor: NATIVE_COLORS.dark.background,
  ios: {
    bundleIdentifier: "com.openducktor.mobile",
    buildNumber,
    supportsTablet: true,
    infoPlist: {
      NSCameraUsageDescription: CAMERA_REASON,
      NSLocalNetworkUsageDescription: LOCAL_NETWORK_REASON,
      NSPhotoLibraryAddUsageDescription: PHOTOS_ADD_REASON,
      // Hosts on a protected network can use plain HTTP. HTTPS keeps normal certificate checks.
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: true },
      ITSAppUsesNonExemptEncryption: false,
      UIRequiresFullScreen: false,
    },
  },
  android: {
    package: "com.openducktor.mobile",
    versionCode: Number(buildNumber),
    adaptiveIcon: {
      foregroundImage: "./assets/images/adaptive-foreground.png",
      monochromeImage: "./assets/images/adaptive-monochrome.png",
      backgroundColor: "#5100FF",
    },
    permissions: ["android.permission.INTERNET", "android.permission.CAMERA"],
    blockedPermissions: [
      "android.permission.RECORD_AUDIO",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.READ_MEDIA_IMAGES",
      "android.permission.READ_MEDIA_VIDEO",
      "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
      "android.permission.SYSTEM_ALERT_WINDOW",
      "android.permission.POST_NOTIFICATIONS",
      "android.permission.VIBRATE",
    ],
    predictiveBackGestureEnabled: true,
  },
  plugins: [
    // The app colors come from the Unistyles theme, so a color scheme change needs no render of
    // every screen.
    ["expo-router", { adaptiveColors: false }],
    // The Android navigation buttons stay hidden (`AppSystemBars`). A swipe shows them over the
    // tab bar, so they need no contrast scrim. `SystemBars` sets their color from the app theme.
    [
      "react-native-edge-to-edge",
      { android: { parentTheme: "Default", enforceNavigationBarContrast: false } },
    ],
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash-mark.png",
        imageWidth: 120,
        resizeMode: "contain",
        backgroundColor: NATIVE_COLORS.light.background,
        dark: {
          image: "./assets/images/splash-mark.png",
          backgroundColor: NATIVE_COLORS.dark.background,
        },
      },
    ],
    [
      "expo-font",
      {
        ios: { fonts: [...SANS_FONTS, ...MONO_FONTS, LUCIDE_FONT].map((font) => font.path) },
        android: {
          fonts: [
            { fontFamily: "SpaceGrotesk", fontDefinitions: SANS_FONTS },
            { fontFamily: "IBMPlexMono", fontDefinitions: MONO_FONTS },
            // Icons are Lucide glyphs, as on desktop. `scripts/lucide-glyphs.ts` maps each icon.
            { fontFamily: "Lucide", fontDefinitions: [LUCIDE_FONT] },
          ],
        },
      },
    ],
    [
      "expo-camera",
      {
        cameraPermission: CAMERA_REASON,
        microphonePermission: MICROPHONE_REASON,
        recordAudioAndroid: false,
        barcodeScannerEnabled: true,
      },
    ],
    // The photo library picker needs no library permission. The camera reason is the QR scan reason,
    // because image picker attachments never open the camera. `android.blockedPermissions` removes
    // the Android audio permission that a microphone reason adds.
    [
      "expo-image-picker",
      {
        photosPermission: PHOTOS_READ_REASON,
        cameraPermission: CAMERA_REASON,
        microphonePermission: MICROPHONE_REASON,
      },
    ],
    ["expo-build-properties", { android: { extraProguardRules: ANDROID_PROGUARD_RULES } }],
    "./plugins/with-android-network-security.js",
    ["./plugins/with-android-theme-colors.js", NATIVE_COLORS],
    "./plugins/with-android-release-signing.js",
    "./plugins/with-ios-release-signing.js",
  ],
  // Releases ship through the stores only; the app has no over-the-air updates.
  updates: { enabled: false },
  experiments: { typedRoutes: false },
};

export default config;
