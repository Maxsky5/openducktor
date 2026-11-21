import { MouseSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { MOTION_EASE_OUT } from "./motion";

export const horizontalTabDropAnimation = {
  duration: 220,
  easing: MOTION_EASE_OUT,
};

export const horizontalTabSortTransition = {
  duration: 180,
  easing: MOTION_EASE_OUT,
};

const TAB_DRAG_SENSOR_OPTIONS = { activationConstraint: { distance: 6 } };

/** The drag sensors of tab strips. A drag starts after 6 px, so a click still selects the tab. */
export const useTabDragSensors = () => {
  const PrimarySensor = globalThis.PointerEvent === undefined ? MouseSensor : PointerSensor;
  return useSensors(useSensor(PrimarySensor, TAB_DRAG_SENSOR_OPTIONS));
};
