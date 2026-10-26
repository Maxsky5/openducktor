// babel-preset-expo adds the Reanimated worklets plugin. Unistyles processes the app sources.
module.exports = (api) => {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: [["react-native-unistyles/plugin", { root: "src" }]],
  };
};
