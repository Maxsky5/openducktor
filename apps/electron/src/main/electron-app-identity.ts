import { mkdirSync } from "node:fs";
import path from "node:path";

type ElectronAppIdentity = {
  getPath(name: "appData"): string;
  setName(name: string): void;
  setPath(name: "userData" | "sessionData", value: string): void;
};

type CreateProfileDirectory = (profilePath: string) => void;

const errorMessage = (cause: unknown): string => {
  if (cause instanceof Error) {
    return cause.message;
  }
  return String(cause);
};

const createProfileDirectory: CreateProfileDirectory = (profilePath) => {
  mkdirSync(profilePath, { recursive: true });
};

export const resolveElectronProfilePath = (appDataPath: string, appName: string): string =>
  path.join(appDataPath, appName);

export const configureElectronAppIdentity = (
  app: ElectronAppIdentity,
  appName: string,
  createDirectory: CreateProfileDirectory = createProfileDirectory,
): void => {
  app.setName(appName);
  const profilePath = resolveElectronProfilePath(app.getPath("appData"), appName);
  try {
    createDirectory(profilePath);
  } catch (cause) {
    throw new Error(
      `Failed to create OpenDucktor Electron profile directory at ${profilePath}: ${errorMessage(cause)}`,
      { cause },
    );
  }
  app.setPath("userData", profilePath);
  app.setPath("sessionData", profilePath);
};
