import { createContext } from "react";

/** Hidden content must not take focus or claim the sheet's close control. */
export const ModalLoadingContext = createContext(false);
