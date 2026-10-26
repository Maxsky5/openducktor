import { createContext } from "react";
import type { TerminalTransportController } from "@openducktor/frontend-core/terminals/terminal-transport-controller";

export const TerminalActivityContext = createContext<TerminalTransportController | null>(null);
