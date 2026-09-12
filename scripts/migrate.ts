import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
await import("../src/server/db");
console.log("数据库迁移完成");
