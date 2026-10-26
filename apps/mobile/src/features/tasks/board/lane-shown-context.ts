import { createContext } from "react";

/**
 * True for the lane that the board shows. The running light of a card turns on the UI thread on
 * each frame, so it runs only in that lane. The cards do not read it, so a lane change renders
 * only the lights.
 */
export const LaneShownContext = createContext(true);
