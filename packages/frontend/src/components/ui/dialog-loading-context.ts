import { createContext } from "react";

export const DialogLoadingContext = createContext<{ loading: boolean; label: string } | null>(null);
