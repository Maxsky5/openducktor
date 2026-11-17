import { createContext, useContext } from "react";
import { createUnavailableShellBridge, type ShellPlatform } from "./shell-bridge";

export const ShellPlatformContext = createContext<ShellPlatform>(createUnavailableShellBridge());

export const useShellPlatform = (): ShellPlatform => useContext(ShellPlatformContext);
