import { RuleTester } from "oxlint/plugins-dev";

import { restrictedFilePathsRule } from "./restricted-file-paths.ts";

const options = [
	{ pattern: "/src/commands/", message: "Commands belong under src/interface/commands." },
	{ pattern: "/adapters/[^/]+\\.ts$", message: "Adapters live in named submodules." },
];

new RuleTester().run("restricted-file-paths", restrictedFilePathsRule, {
	valid: [
		{ filename: "/repo/src/interface/commands/run.ts", code: "export {};", options },
		{ filename: "/repo/src/adapters/git/git-port.ts", code: "export {};", options },
		{ filename: "/repo/src/commands/run.ts", code: "export {};" },
	],
	invalid: [
		{
			filename: "/repo/src/commands/run.ts",
			code: "export {};",
			options,
			errors: [
				{
					messageId: "restrictedFilePath",
					data: { message: "Commands belong under src/interface/commands." },
				},
			],
		},
		{
			filename: "C:\\repo\\src\\adapters\\git.ts",
			code: "export {};",
			options,
			errors: [
				{
					messageId: "restrictedFilePath",
					data: { message: "Adapters live in named submodules." },
				},
			],
		},
	],
});
