type ElectronCommandLine = {
  appendSwitch(name: string, value?: string): void;
};

export const disableElectronKeychainStorage = (commandLine: ElectronCommandLine): void => {
  commandLine.appendSwitch("use-mock-keychain");
  commandLine.appendSwitch("password-store", "basic");
};
