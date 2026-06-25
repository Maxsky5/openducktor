import { mkdirSync } from "node:fs";
import path from "node:path";
import { resolveOpenDucktorBaseDir } from "@openducktor/host";
import { ElectronOperationError, errorMessage } from "../effect/electron-errors";

type ElectronAppIdentity = {
  setName(name: string): void;
  setPath(name: "userData" | "sessionData", value: string): void;
};

type CreateProfileDirectory = (profilePath: string) => void;
type ResolveConfigDirectory = (env?: NodeJS.ProcessEnv) => string;

type ConfigureElectronAppIdentityOptions = {
  appName: string;
  createDirectory?: CreateProfileDirectory;
  processEnv?: NodeJS.ProcessEnv;
  resolveConfigDirectory?: ResolveConfigDirectory;
};

const createProfileDirectory: CreateProfileDirectory = (profilePath) => {
  mkdirSync(profilePath, { recursive: true });
};

const ELECTRON_PROFILE_DIR_NAME = "electron-profile";

export const resolveElectronProfilePath = (configDirectory: string): string =>
  path.resolve(configDirectory, ELECTRON_PROFILE_DIR_NAME);

export const configureElectronAppIdentity = (
  app: ElectronAppIdentity,
  {
    appName,
    createDirectory = createProfileDirectory,
    processEnv = process.env,
    resolveConfigDirectory = resolveOpenDucktorBaseDir,
  }: ConfigureElectronAppIdentityOptions,
): void => {
  app.setName(appName);
  let profilePath = "";
  try {
    profilePath = resolveElectronProfilePath(resolveConfigDirectory(processEnv));
    createDirectory(profilePath);
  } catch (cause) {
    const pathContext = profilePath.length > 0 ? ` at ${profilePath}` : "";
    throw new ElectronOperationError({
      operation: "electron.app-identity.prepare-profile-directory",
      message: `Failed to prepare ${appName} Electron profile directory${pathContext}: ${errorMessage(cause)}`,
      path: profilePath.length > 0 ? profilePath : undefined,
      cause,
      details: { appName },
    });
  }
  app.setPath("userData", profilePath);
  app.setPath("sessionData", profilePath);
};
