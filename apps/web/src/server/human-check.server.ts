import { env } from "cloudflare:workers";

export const humanCheckSiteKey = () => env.TURNSTILE_SITE_KEY;
