import Constants from "expo-constants";

/** The store version and build number of this app, such as `1.0.0 (42)`. */
export const appVersionLabel = (): string => {
  const version = Constants.expoConfig?.version ?? "unknown";
  const build =
    Constants.expoConfig?.ios?.buildNumber ?? Constants.expoConfig?.android?.versionCode ?? null;
  return build === null ? version : `${version} (${build})`;
};
