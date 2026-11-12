import { createContext } from "react";

/**
 * The side padding of the buttons inside it. `compact` gives every size the small side padding,
 * for buttons that share one row of a phone, such as the actions of a form footer.
 */
export type ButtonDensity = "regular" | "compact";
export const ButtonDensityContext = createContext<ButtonDensity>("regular");
