// The one place that loads GSAP for the scenes and the site animations. The page players register
// ScrollTrigger in scroll.ts, so a host that controls its scenes, such as the app tour, loads no
// scroll listener.
import { gsap } from "gsap";

export { gsap };
