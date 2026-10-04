import { eslintCompatPlugin } from "@oxlint/plugins";

import { restrictedFilePathsRule } from "./rules/restricted-file-paths.ts";

/** Opt-in Oxlint rules for project structure that built-in rules cannot express. */
const architecturePlugin = eslintCompatPlugin({
	meta: { name: "architecture" },
	rules: {
		"restricted-file-paths": restrictedFilePathsRule,
	},
});

export default architecturePlugin;
