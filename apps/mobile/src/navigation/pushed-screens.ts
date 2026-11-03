/** Sessions, tasks, and work views are pushed screens of the app stack. The other routes are sheets. */
export const isPushedScreen = (name: string): boolean =>
  name === "session" || name.startsWith("task/") || name.startsWith("work/");

/**
 * True when no pushed screen lies above the route in its stack. A sheet above the route leaves it in
 * view: the route stays on screen and current for its work. A route that the routes do not hold yet
 * is the route that a push adds on top, so it is in view.
 */
export const isRouteInView = (
  routes: readonly { key: string; name: string }[],
  routeKey: string,
): boolean => {
  const index = routes.findIndex((route) => route.key === routeKey);
  if (index === -1) return true;
  return !routes.some((route, position) => position > index && isPushedScreen(route.name));
};
