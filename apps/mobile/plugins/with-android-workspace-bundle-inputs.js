// Makes the release JS bundle of Android follow the shared workspace packages. The React Native
// bundle task tracks only the sources of this app folder. Metro also bundles the `packages/*`
// sources, so without these inputs Gradle reuses an old bundle after a change there, and a
// release build ships code that the repository no longer has.
const { withAppBuildGradle } = require("expo/config-plugins");

const MARKER = "// openducktor-workspace-bundle-inputs";

/** The repository folder, relative to the Android root project, that holds the shared packages. */
const WORKSPACE_PACKAGES_DIR = "../../../packages";

const BUNDLE_INPUTS = `${MARKER}
tasks.withType(com.facebook.react.tasks.BundleHermesCTask).configureEach {
    inputs.files(fileTree("\${rootDir}/${WORKSPACE_PACKAGES_DIR}") {
        include "*/package.json", "*/src/**/*.js", "*/src/**/*.jsx", "*/src/**/*.ts", "*/src/**/*.tsx"
        exclude "**/*.test.ts", "**/*.test.tsx"
    }).withPropertyName("openducktorWorkspaceSources").withPathSensitivity(PathSensitivity.RELATIVE)
}
`;

/** @param {string} gradle */
const applyWorkspaceBundleInputs = (gradle) =>
  gradle.includes(MARKER) ? gradle : `${gradle.trimEnd()}\n\n${BUNDLE_INPUTS}`;

/** @param {import("expo/config-plugins").ExpoConfig} config */
const withAndroidWorkspaceBundleInputs = (config) =>
  withAppBuildGradle(config, (modConfig) => {
    modConfig.modResults.contents = applyWorkspaceBundleInputs(modConfig.modResults.contents);
    return modConfig;
  });

module.exports = withAndroidWorkspaceBundleInputs;
module.exports.WORKSPACE_PACKAGES_DIR = WORKSPACE_PACKAGES_DIR;
