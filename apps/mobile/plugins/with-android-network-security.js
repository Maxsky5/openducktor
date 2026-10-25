// Lets the app reach a saved host over plain HTTP on a protected network, as the remote protocol
// allows for native clients. Only system certificate authorities are trusted for HTTPS, so a user
// or app CA cannot weaken TLS validation.
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require("expo/config-plugins");
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const RESOURCE_NAME = "openducktor_network_security";

const NETWORK_SECURITY_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="true">
    <trust-anchors>
      <certificates src="system" />
    </trust-anchors>
  </base-config>
</network-security-config>
`;

/** @param {import("expo/config-plugins").ExpoConfig} config */
const withAndroidNetworkSecurity = (config) => {
  const withFile = withDangerousMod(config, [
    "android",
    async (modConfig) => {
      const directory = join(modConfig.modRequest.platformProjectRoot, "app/src/main/res/xml");
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, `${RESOURCE_NAME}.xml`), NETWORK_SECURITY_CONFIG);
      return modConfig;
    },
  ]);
  return withAndroidManifest(withFile, (modConfig) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(modConfig.modResults);
    application.$["android:networkSecurityConfig"] = `@xml/${RESOURCE_NAME}`;
    application.$["android:usesCleartextTraffic"] = "true";
    return modConfig;
  });
};

module.exports = withAndroidNetworkSecurity;
