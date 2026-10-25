import { eslintCompatPlugin } from "@oxlint/plugins";

import { noStylesheetDependencyAliasesRule } from "./rules/no-stylesheet-dependency-aliases.ts";
import { noThemedColorsOnUnboundComponentsRule } from "./rules/no-themed-colors-on-unbound-components.ts";

/** Opt-in Oxlint rules for the Unistyles contracts that its Babel plugin relies on. */
const unistylesPlugin = eslintCompatPlugin({
	meta: { name: "unistyles" },
	rules: {
		"no-stylesheet-dependency-aliases": noStylesheetDependencyAliasesRule,
		"no-themed-colors-on-unbound-components": noThemedColorsOnUnboundComponentsRule,
	},
});

export default unistylesPlugin;
