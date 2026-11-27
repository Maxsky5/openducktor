/**
 * The Permissions Policy of an isolated preview. It denies every powerful feature, so a page
 * cannot request a device capability or a permission prompt.
 */
export const ISOLATED_PREVIEW_PERMISSIONS_POLICY =
  "accelerometer=(), ambient-light-sensor=(), autoplay=(), bluetooth=(), camera=(), clipboard-read=(), clipboard-write=(), display-capture=(), geolocation=(), gyroscope=(), hid=(), idle-detection=(), local-fonts=(), magnetometer=(), microphone=(), midi=(), payment=(), publickey-credentials-get=(), screen-wake-lock=(), serial=(), usb=(), web-share=(), xr-spatial-tracking=()";
