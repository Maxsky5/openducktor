import { mkdirSync } from "node:fs";
import path from "node:path";
import { resolveOpenDucktorBaseDir, validateDevelopmentInstanceId } from "@openducktor/host";
import { ElectronOperationError, errorMessage } from "../effect/electron-errors";

type ElectronAppIdentity = {
  setName(name: string): void;
  setPath(name: "userData" | "sessionData", value: string): void;
};

type ElectronWindowsAppIdentity = {
  setAppUserModelId(id: string): void;
};

type CreateProfileDirectory = (profilePath: string) => void;
type ResolveConfigDirectory = (env?: NodeJS.ProcessEnv) => string;

export type ElectronProfileKind = "development" | "production";

export const resolveElectronProfileKind = (isPackaged: boolean): ElectronProfileKind =>
  isPackaged ? "production" : "development";

type ConfigureElectronAppIdentityOptions = {
  appName: string;
  createDirectory?: CreateProfileDirectory;
  developmentInstanceId?: string;
  profileKind: ElectronProfileKind;
  processEnv?: NodeJS.ProcessEnv;
  resolveConfigDirectory?: ResolveConfigDirectory;
};

const OPEN_DUCKTOR_APP_USER_MODEL_ID = "com.openducktor.app";

export const configureElectronWindowsAppIdentity = (
  app: ElectronWindowsAppIdentity,
  {
    isPackaged,
    platform,
    processExecPath,
  }: {
    isPackaged: boolean;
    platform: NodeJS.Platform;
    processExecPath: string;
  },
): void => {
  if (platform === "win32") {
    app.setAppUserModelId(isPackaged ? OPEN_DUCKTOR_APP_USER_MODEL_ID : processExecPath);
  }
};

const createProfileDirectory: CreateProfileDirectory = (profilePath) => {
  mkdirSync(profilePath, { recursive: true });
};

export const resolveElectronProfilePath = (
  configDirectory: string,
  profileKind: ElectronProfileKind,
  developmentInstanceId?: string,
): string => {
  if (profileKind === "production") {
    return path.resolve(configDirectory, "electron-profile");
  }
  if (!developmentInstanceId) {
    throw new ElectronOperationError({
      operation: "electron.app-identity.resolve-development-profile",
      message: "A development instance is required for the Electron development profile.",
    });
  }
  const validatedInstanceId = validateDevelopmentInstanceId(developmentInstanceId);
  return path.resolve(
    configDirectory,
    "runtime",
    "dev-instances",
    validatedInstanceId,
    "electron-profile",
  );
};

export const configureElectronAppIdentity = (
  app: ElectronAppIdentity,
  {
    appName,
    createDirectory = createProfileDirectory,
    developmentInstanceId,
    profileKind,
    processEnv = process.env,
    resolveConfigDirectory = resolveOpenDucktorBaseDir,
  }: ConfigureElectronAppIdentityOptions,
): void => {
  app.setName(appName);
  let profilePath = "";
  try {
    profilePath = resolveElectronProfilePath(
      resolveConfigDirectory(processEnv),
      profileKind,
      developmentInstanceId,
    );
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
