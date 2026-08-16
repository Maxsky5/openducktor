import releasePackageJson from "../../../../package.json";

export const resolveElectronAppVersion = ({
  isPackaged,
  packagedVersion,
}: {
  isPackaged: boolean;
  packagedVersion: string;
}): string => (isPackaged ? packagedVersion : releasePackageJson.version);
