import pkg from "../../package.json";

/** Single source of truth for the app's release version. Imported
 * from package.json at build time so the published image, server
 * routes, and client surfaces (sidebar footer, settings → about)
 * always agree on the number. */
export const APP_VERSION: string = pkg.version;
