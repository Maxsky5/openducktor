import { useNavigation, useRoute } from "expo-router";
import { useEffect, useState } from "react";
import { isRouteInView } from "./pushed-screens";

/**
 * True while no pushed screen covers this screen. A sheet leaves the screen in view, so opening or
 * closing a sheet does not render the screen again. The value changes only when a pushed screen
 * comes or goes. On the first render of a pushed screen, `getState` still gives the routes before
 * the push, which do not hold this screen yet.
 */
export const useScreenInView = (): boolean => {
  const navigation = useNavigation();
  const { key } = useRoute();
  const [inView, setInView] = useState(() =>
    isRouteInView(navigation.getState()?.routes ?? [], key),
  );
  useEffect(
    () =>
      navigation.addListener("state", (event) => {
        setInView(isRouteInView(event.data.state.routes, key));
      }),
    [key, navigation],
  );
  return inView;
};
