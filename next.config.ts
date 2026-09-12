import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["127.0.0.1"],
  serverExternalPackages: ["better-sqlite3"],
  outputFileTracingExcludes: {
    "/*": ["./.env*", "./data/**/*", "./.tmp/**/*", "./.codex/**/*"],
  },
};
export default config;
