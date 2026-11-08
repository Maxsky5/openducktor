import { LANE_TITLES } from "@openducktor/product-scenes/vocabulary";

/**
 * The titles of the board lanes, with the lane IDs of the app, and the QA Rejected badge of a task
 * card. `components/lane-pill.css` gives each one its color.
 */
export const LANE_LABELS = { ...LANE_TITLES, qa_rejected: "QA Rejected" };

export type LaneId = keyof typeof LANE_LABELS;
