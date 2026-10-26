import type { NativeStackNavigationOptions } from "expo-router";
import { readSessionRouteTitle } from "../session-route";
import { RouteSessionTitle } from "./session-header-title";

/**
 * The navigation bar of a session route on the first frame of its push: the title that the row
 * passed, in the view of the session header. The session screen then sets its full header. A
 * route without a title, such as a link, shows no title until then.
 */
export const sessionRouteOptions = ({
  route,
}: {
  route: { params?: object | undefined };
}): NativeStackNavigationOptions => {
  const { title, task } = readSessionRouteTitle(route);
  return {
    title,
    headerTitle: () => <RouteSessionTitle title={title} task={task} />,
  };
};
