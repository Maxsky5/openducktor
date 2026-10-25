// Signs the iOS Release build with the App Store profile when CI supplies it. The build settings go
// on the app target only. Signing settings on the xcodebuild command line also reach the Pods
// targets, and Xcode rejects a provisioning profile on a target that cannot use one. Without the
// profile name, a local prebuild keeps the default automatic signing.
const { IOSConfig, withXcodeProject } = require("expo/config-plugins");

const IDENTITY = '"Apple Distribution"';

/**
 * @param {import("expo/config-plugins").XcodeProject} project
 * @param {string} projectName
 * @param {{ profileName: string; teamId: string }} signing
 */
const applyReleaseSigning = (project, projectName, signing) => {
  const { target } = IOSConfig.XcodeUtils.getApplicationNativeTarget({ project, projectName });
  const [, release] = IOSConfig.XcodeUtils.getBuildConfigurationForListIdAndName(project, {
    configurationListId: target.buildConfigurationList,
    buildConfiguration: "Release",
  });
  Object.assign(release.buildSettings, {
    CODE_SIGN_STYLE: "Manual",
    DEVELOPMENT_TEAM: signing.teamId,
    CODE_SIGN_IDENTITY: IDENTITY,
    // The project level sets this SDK variant to the development identity.
    '"CODE_SIGN_IDENTITY[sdk=iphoneos*]"': IDENTITY,
    PROVISIONING_PROFILE_SPECIFIER: JSON.stringify(signing.profileName),
  });
  return project;
};

/** @param {import("expo/config-plugins").ExpoConfig} config */
const withIosReleaseSigning = (config) =>
  withXcodeProject(config, (modConfig) => {
    const profileName = process.env.OPENDUCKTOR_IOS_PROVISIONING_PROFILE_NAME;
    if (!profileName) return modConfig;
    const teamId = process.env.OPENDUCKTOR_IOS_TEAM_ID;
    if (!teamId) {
      throw new Error("Set OPENDUCKTOR_IOS_TEAM_ID to sign the OpenDucktor iOS release build.");
    }
    modConfig.modResults = applyReleaseSigning(
      modConfig.modResults,
      modConfig.modRequest.projectName,
      { profileName, teamId },
    );
    return modConfig;
  });

module.exports = withIosReleaseSigning;
