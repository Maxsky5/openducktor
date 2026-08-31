import { mkdirSync } from "node:fs";
import path from "node:path";
import { resolveOpenDucktorBaseDir, validateDevelopmentInstanceId } from "@openducktor/host";
import { ElectronOperationError, errorMessage } from "../effect/electron-errors";

type ElectronAppIdentity = {
  setName(name: string): void;
  setPath(name: "userData" | "sessionData", value: string): void;
  setAppUserModelId?(id: string): void;
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
  platform?: NodeJS.Platform;
  processEnv?: NodeJS.ProcessEnv;
  resolveConfigDirectory?: ResolveConfigDirectory;
};

export const OPEN_DUCKTOR_APP_USER_MODEL_ID = "com.openducktor.app";

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
    platform = process.platform,
    profileKind,
    processEnv = process.env,
    resolveConfigDirectory = resolveOpenDucktorBaseDir,
  }: ConfigureElectronAppIdentityOptions,
): void => {
  app.setName(appName);
  if (platform === "win32") {
    if (!app.setAppUserModelId) {
      throw new ElectronOperationError({
        operation: "electron.app-identity.configure-windows-app-id",
        message: "Electron cannot configure the Windows app user model ID.",
      });
    }
    app.setAppUserModelId(OPEN_DUCKTOR_APP_USER_MODEL_ID);
  }
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
