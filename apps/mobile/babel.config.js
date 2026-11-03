// babel-preset-expo adds the Reanimated worklets plugin. Unistyles processes the app sources.
// The React Compiler moves a function that reads no component value out of its component. A
// worklet that holds such a function would then call JavaScript from the UI thread and crash, so
// the compiler keeps functions in place.
module.exports = (api) => {
  api.cache(true);
  return {
    presets: [
      [
        "babel-preset-expo",
        { "react-compiler": { environment: { enableFunctionOutlining: false } } },
      ],
    ],
    plugins: [["react-native-unistyles/plugin", { root: "src" }]],
  };
};
