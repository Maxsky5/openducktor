import { RuleTester } from "oxlint/plugins-dev";

import { requirePageOccluderRule } from "./require-page-occluder.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "tsx" } } });
const error = { messageId: "missingOccluder" };

tester.run("architecture/require-page-occluder", requirePageOccluderRule, {
	valid: [
		"createPortal(<div data-page-occluder=''>tip</div>, document.body);",
		"createPortal(<><span /><div data-page-occluder>tip</div></>, host);",
		"const a = <Primitive.Portal><Primitive.Content data-page-occluder='' /></Primitive.Portal>;",
		"const a = <SheetPortal>{open ? <div data-page-occluder='' /> : null}</SheetPortal>;",
		"const a = <Primitive.Portal data-slot='dialog-portal' {...props} />;",
		"const a = <Portal />;",
		"render(<div />, host);",
	],
	invalid: [
		{ code: "createPortal(<div>tip</div>, document.body);", errors: [error] },
		{ code: "createPortal(<Overlay />, document.body);", errors: [error] },
		{ code: "const a = <Primitive.Portal><Primitive.Content /></Primitive.Portal>;", errors: [error] },
		{ code: "const a = <DialogPortal><div /></DialogPortal>;", errors: [error] },
	],
});
