import { createContext } from "react";
import type { TerminalTransportController } from "@/features/terminals/terminal-transport-controller";

export const TerminalActivityContext = createContext<TerminalTransportController | null>(null);
