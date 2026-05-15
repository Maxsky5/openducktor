import type { OpenDucktorElectronApi } from "../shared/electron-bridge-contract";

declare global {
  interface Window {
    openducktorElectron: OpenDucktorElectronApi;
  }
}
