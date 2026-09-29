// The site stylesheets: the recommended rules find invalid CSS, and the rules below keep the
// selectors simple. The formatter owns the code style.
export default {
  extends: ["stylelint-config-recommended"],
  rules: {
    "declaration-property-value-no-unknown": true,
    "declaration-no-important": true,
    "selector-max-specificity": "0,5,0",
    "selector-max-compound-selectors": 5,
    "selector-max-id": 0,
    // A `will-change` rule keeps a compositor layer also with reduced motion. GSAP promotes an
    // element only while a transform tween runs.
    "property-disallowed-list": ["will-change"],
    // The site works from Safari 16.4 and Chrome 111. light-dark() needs Safari 17.5 and Chrome
    // 123, and linear() needs Safari 17.2. A dark theme rule uses :root[data-theme="dark"].
    "function-disallowed-list": ["light-dark", "linear"],
    // Different parts of a component often end with the same class, such as `.lucide`. A
    // stylesheet keeps the rules of each part together, so the source order cannot follow
    // the specificity.
    "no-descending-specificity": null,
  },
};
