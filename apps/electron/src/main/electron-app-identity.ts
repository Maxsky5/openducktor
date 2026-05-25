import path from "node:path";

type ElectronAppIdentity = {
  getPath(name: "appData"): string;
  setName(name: string): void;
  setPath(name: "userData" | "sessionData", value: string): void;
};

export const resolveElectronProfilePath = (appDataPath: string, appName: string): string =>
  path.join(appDataPath, appName);

export const configureElectronAppIdentity = (app: ElectronAppIdentity, appName: string): void => {
  app.setName(appName);
  const profilePath = resolveElectronProfilePath(app.getPath("appData"), appName);
  app.setPath("userData", profilePath);
  app.setPath("sessionData", profilePath);
};
