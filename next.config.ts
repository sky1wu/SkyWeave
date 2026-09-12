import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  outputFileTracingExcludes: {
    "/*": ["./.env*", "./data/**/*", "./.tmp/**/*", "./.codex/**/*"],
  },
};
export default config;
