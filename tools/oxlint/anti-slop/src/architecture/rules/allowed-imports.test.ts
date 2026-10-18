import { RuleTester } from "oxlint/plugins-dev";

import { allowedImportsRule } from "./allowed-imports.ts";

const message = "Add a platform port instead.";
const options = [{ root: "packages/core", packages: ["react", "@scope/lib"], message }];
const filename = "/repo/packages/core/src/state/store.ts";

const packageError = (source: string) => ({
	messageId: "packageNotAllowed",
	data: { source, message },
});
const rootError = (source: string) => ({
	messageId: "outsideRoot",
	data: { source, root: "packages/core", message },
});

new RuleTester().run("allowed-imports", allowedImportsRule, {
	valid: [
		{ filename, code: 'import { useState } from "react";', options },
		{ filename, code: 'import { thing } from "@scope/lib/sub/path";', options },
		{ filename, code: 'import type { Store } from "./types";', options },
		{ filename, code: 'export { helper } from "../../expo/consumer";', options },
		{ filename, code: 'export * from "../lib/index";', options },
		{ filename, code: 'const module = await import("./lazy");', options },
		{ filename, code: "const dynamic = await import(name);", options },
		{
			filename: "C:\\repo\\packages\\core\\src\\state\\store.ts",
			code: 'import { value } from "../value";',
			options,
		},
	],
	invalid: [
		{
			filename,
			code: 'import type { Root } from "react-dom/client";',
			options,
			errors: [packageError("react-dom/client")],
		},
		{
			filename,
			code: 'import { readFile } from "node:fs";',
			options,
			errors: [packageError("node:fs")],
		},
		{
			filename,
			code: 'import { thing } from "@scope/library";',
			options,
			errors: [packageError("@scope/library")],
		},
		{
			filename,
			code: 'export { App } from "@/App";',
			options,
			errors: [packageError("@/App")],
		},
		{
			filename,
			code: 'const module = await import("motion");',
			options,
			errors: [packageError("motion")],
		},
		{
			filename,
			code: 'type Stats = import("node:fs").Stats;',
			options,
			errors: [packageError("node:fs")],
		},
		{
			filename,
			code: 'import { App } from "../../../frontend/src/App";',
			options,
			errors: [rootError("../../../frontend/src/App")],
		},
		{
			filename,
			code: 'export * from "../../../core-extra/index";',
			options,
			errors: [rootError("../../../core-extra/index")],
		},
		{
			filename: "C:\\repo\\packages\\core\\src\\store.ts",
			code: 'import { value } from "../../host/value";',
			options,
			errors: [rootError("../../host/value")],
		},
	],
});
