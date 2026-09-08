import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // F6 — `?view=me` shim. Previously the org page rendered both manager + dev
  // views, switched via a query param. After the split, `/me/[p]/[slug]` is
  // the dev surface; any inbound link still carrying ?view=me lands there.
  async redirects() {
    return [
      {
        source: "/org/:provider/:slug",
        has: [{ type: "query", key: "view", value: "me" }],
        destination: "/me/:provider/:slug",
        permanent: true,
      },
    ];
  },
};
export default nextConfig;
