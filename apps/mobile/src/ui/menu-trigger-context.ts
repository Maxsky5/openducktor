import { createContext } from "react";

/**
 * The open action of the menu around a trigger. The control inside the trigger takes the touch,
 * and a screen reader activates that control, so `Touchable` opens the menu itself.
 */
export type MenuTrigger = { open: () => void; onLongPress: boolean };

export const MenuTriggerContext = createContext<MenuTrigger | null>(null);
