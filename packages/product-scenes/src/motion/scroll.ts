// ScrollTrigger for the page players, which play a view while it is in its part of the screen. Its
// registration adds listeners and a timer to the page, so only a page player imports this module.
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { gsap } from "./gsap";

gsap.registerPlugin(ScrollTrigger);

export { ScrollTrigger };
