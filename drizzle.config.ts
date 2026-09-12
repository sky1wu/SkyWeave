import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_PATH || "./data/trip-planner.sqlite",
  },
});
