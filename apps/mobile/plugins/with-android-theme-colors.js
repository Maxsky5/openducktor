// Gives the native Android theme the app colors in light and dark mode. System dialogs, text
// cursors, and selection handles use the OpenDucktor violet, and the window background matches
// the screen background, so no dark frame shows behind a light screen.
const {
  AndroidConfig,
  withAndroidColors,
  withAndroidColorsNight,
  withAndroidStyles,
} = require("expo/config-plugins");

/** @param {{ background: string, accent: string }} colors */
const themeColors = ({ background, accent }) => ({
  colorAccent: accent,
  activityBackground: background,
});

/** @param {import("expo/config-plugins").AndroidConfig.Resources.ResourceXML} xml */
const setColors = (xml, values) => {
  let next = xml;
  for (const [name, value] of Object.entries(values)) {
    next = AndroidConfig.Colors.setColorItem(
      AndroidConfig.Resources.buildResourceItem({ name, value }),
      next,
    );
  }
  return next;
};

/**
 * `app.config.ts` passes the colors.
 * @param {import("expo/config-plugins").ExpoConfig} config
 * @param {Record<"light" | "dark", { background: string, accent: string }>} colors
 */
const withAndroidThemeColors = (config, colors) => {
  const withLight = withAndroidColors(config, (modConfig) => {
    modConfig.modResults = setColors(modConfig.modResults, themeColors(colors.light));
    return modConfig;
  });
  const withDark = withAndroidColorsNight(withLight, (modConfig) => {
    modConfig.modResults = setColors(modConfig.modResults, themeColors(colors.dark));
    return modConfig;
  });
  return withAndroidStyles(withDark, (modConfig) => {
    modConfig.modResults = AndroidConfig.Styles.assignStylesValue(modConfig.modResults, {
      add: true,
      parent: AndroidConfig.Styles.getAppThemeGroup(),
      name: "colorAccent",
      value: "@color/colorAccent",
    });
    return modConfig;
  });
};

module.exports = withAndroidThemeColors;
