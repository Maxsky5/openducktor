import { createContext } from "react";

/**
 * True for the screens of the tabs while the navigation rail shows on the left edge. The rail
 * takes the left safe area, so these screens leave it out.
 */
export const NavigationRailContext = createContext(false);
