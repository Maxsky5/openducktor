import { mkdirSync } from "node:fs";
import path from "node:path";
import { resolveOpenDucktorBaseDir } from "@openducktor/host";

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

const errorMessage = (cause: unknown): string => {
  if (cause instanceof Error) {
    return cause.message;
  }
  return String(cause);
};

const createProfileDirectory: CreateProfileDirectory = (profilePath) => {
  mkdirSync(profilePath, { recursive: true });
};

const ELECTRON_PROFILE_DIR_NAME = "electron-profile";

export const resolveElectronProfilePath = (configDirectory: string): string =>
  path.join(configDirectory, ELECTRON_PROFILE_DIR_NAME);

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
  const profilePath = resolveElectronProfilePath(resolveConfigDirectory(processEnv));
  try {
    createDirectory(profilePath);
  } catch (cause) {
    throw new Error(
      `Failed to create ${appName} Electron profile directory at ${profilePath}: ${errorMessage(cause)}`,
      { cause },
    );
  }
  app.setPath("userData", profilePath);
  app.setPath("sessionData", profilePath);
};
