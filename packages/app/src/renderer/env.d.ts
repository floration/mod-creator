/** The app's version from packages/app/package.json, filled in by vite.config.ts. */
declare const __APP_VERSION__: string;

declare module "*.png" {
  const url: string;
  export default url;
}
