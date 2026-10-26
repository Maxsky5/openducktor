// Signs Android release builds with the upload key when CI supplies it. Gradle names any signing
// value that is missing. Without the keystore path, a local release build keeps the debug key for
// profiling only.
const { withAppBuildGradle } = require("expo/config-plugins");

const MARKER = "// openducktor-release-signing";

const HELPER = `${MARKER}
def openducktorSigningValue(String name) {
    def value = System.getenv(name)
    if (!value) {
        throw new GradleException("Set " + name + " to sign the OpenDucktor release build.")
    }
    return value
}
def openducktorUploadKeystore = System.getenv("OPENDUCKTOR_ANDROID_UPLOAD_KEYSTORE_PATH")
`;

const RELEASE_SIGNING = `        release {
            if (openducktorUploadKeystore) {
                storeFile file(openducktorUploadKeystore)
                storePassword openducktorSigningValue("OPENDUCKTOR_ANDROID_UPLOAD_KEYSTORE_PASSWORD")
                keyAlias openducktorSigningValue("OPENDUCKTOR_ANDROID_UPLOAD_KEY_ALIAS")
                keyPassword openducktorSigningValue("OPENDUCKTOR_ANDROID_UPLOAD_KEY_PASSWORD")
            }
        }
`;

/** @param {string} gradle */
const applyReleaseSigning = (gradle) => {
  if (gradle.includes(MARKER)) return gradle;
  const signingStart = gradle.indexOf("signingConfigs {");
  const debugEnd = gradle.indexOf("        }\n", gradle.indexOf("debug {", signingStart));
  if (signingStart < 0 || debugEnd < 0) {
    throw new Error("The Android app build.gradle has no debug signing config to extend.");
  }
  const releaseStart = gradle.indexOf("release {", gradle.indexOf("buildTypes {"));
  const releaseSigning = gradle.indexOf("signingConfig signingConfigs.debug", releaseStart);
  if (releaseStart < 0 || releaseSigning < 0) {
    throw new Error("The Android app build.gradle has no release build type to sign.");
  }
  const withSigningConfig =
    gradle.slice(0, debugEnd + "        }\n".length) +
    RELEASE_SIGNING +
    gradle.slice(debugEnd + "        }\n".length);
  const offset = RELEASE_SIGNING.length;
  const signingLine = releaseSigning + offset;
  const withReleaseType =
    withSigningConfig.slice(0, signingLine) +
    "signingConfig openducktorUploadKeystore ? signingConfigs.release : signingConfigs.debug" +
    withSigningConfig.slice(signingLine + "signingConfig signingConfigs.debug".length);
  const androidBlock = withReleaseType.indexOf("\nandroid {");
  return `${withReleaseType.slice(0, androidBlock + 1)}${HELPER}\n${withReleaseType.slice(androidBlock + 1)}`;
};

/** @param {import("expo/config-plugins").ExpoConfig} config */
const withAndroidReleaseSigning = (config) =>
  withAppBuildGradle(config, (modConfig) => {
    modConfig.modResults.contents = applyReleaseSigning(modConfig.modResults.contents);
    return modConfig;
  });

module.exports = withAndroidReleaseSigning;
module.exports.applyReleaseSigning = applyReleaseSigning;
