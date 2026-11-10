import { createContext, use } from "react";

export const NativeParagraphKeyContext = createContext<number | undefined>(undefined);

/**
 * A native iOS Text key provided only within the transcript at a new system text size.
 * Native selection and accessibility leaf focus reset; surrounding state stays mounted.
 */
export function useNativeParagraphKey(): number | undefined {
  return use(NativeParagraphKeyContext);
}
