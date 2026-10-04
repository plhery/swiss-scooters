import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

// Every page of the app is prerendered at build time. Without a cache OpenNext
// renders it again for each request and shares that render between requests
// that arrive together, so what one visitor received depended on who else was
// asking. This read-only cache serves the pages as they were built.
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
});
