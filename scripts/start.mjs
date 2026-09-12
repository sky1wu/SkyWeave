import { cpSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());
const root = process.cwd();
if (!existsSync(".next/standalone/server.js"))
  throw new Error("请先执行 npm run build");
cpSync("public", ".next/standalone/public", { recursive: true });
cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
cpSync("drizzle", ".next/standalone/drizzle", { recursive: true });
process.env.DATABASE_PATH = resolve(
  root,
  process.env.DATABASE_PATH || "./data/trip-planner.sqlite",
);
process.env.HOSTNAME = process.env.APP_HOST || "0.0.0.0";
await import("../.next/standalone/server.js");
