import { eslintCompatPlugin } from "@oxlint/plugins";

import { allowedImportsRule } from "./rules/allowed-imports.ts";
import { requirePageOccluderRule } from "./rules/require-page-occluder.ts";
import { restrictedFilePathsRule } from "./rules/restricted-file-paths.ts";

/** Opt-in Oxlint rules for project structure that built-in rules cannot express. */
const architecturePlugin = eslintCompatPlugin({
	meta: { name: "architecture" },
	rules: {
		"allowed-imports": allowedImportsRule,
		"require-page-occluder": requirePageOccluderRule,
		"restricted-file-paths": restrictedFilePathsRule,
	},
});

export default architecturePlugin;
