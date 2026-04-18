import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  typedRoutes: true,
  // Ported pharos card code has strict-mode violations we don't own. Landing
  // ships in Vercel; the dashboard workstreams still get typechecked by
  // `bun run typecheck` in CI. Revisit after porting stabilizes.
  typescript: { ignoreBuildErrors: true },
};

export default config;
