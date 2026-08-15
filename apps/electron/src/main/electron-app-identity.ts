import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  resolveDevelopmentInstanceIdFromEnvironment,
  resolveOpenDucktorBaseDir,
  validateDevelopmentInstanceId,
} from "@openducktor/host";
import { ElectronOperationError, errorMessage } from "../effect/electron-errors";

type ElectronAppIdentity = {
  setName(name: string): void;
  setPath(name: "userData" | "sessionData", value: string): void;
};

type CreateProfileDirectory = (profilePath: string) => void;
type ResolveConfigDirectory = (env?: NodeJS.ProcessEnv) => string;

export type ElectronProfileKind = "development" | "production";

export const resolveElectronProfileKind = (isPackaged: boolean): ElectronProfileKind =>
  isPackaged ? "production" : "development";

type ConfigureElectronAppIdentityOptions = {
  appName: string;
  createDirectory?: CreateProfileDirectory;
  profileKind: ElectronProfileKind;
  processEnv?: NodeJS.ProcessEnv;
  resolveConfigDirectory?: ResolveConfigDirectory;
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
    profileKind,
    processEnv = process.env,
    resolveConfigDirectory = resolveOpenDucktorBaseDir,
  }: ConfigureElectronAppIdentityOptions,
): void => {
  app.setName(appName);
  let profilePath = "";
  try {
    const developmentInstanceId =
      profileKind === "development"
        ? resolveDevelopmentInstanceIdFromEnvironment(processEnv)
        : undefined;
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
