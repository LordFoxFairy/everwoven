import { defineConfig } from "prisma/config";

// Generation needs no database. Migration requires an explicit absolute file URL.
const url = process.env.RUNTIME_DATABASE_URL;
if (url && (!url.startsWith("file:/") || url.startsWith("file://") || url.includes("?") || url.includes("#"))) {
  throw new Error("RUNTIME_DATABASE_URL must be an absolute file:/path URL without query or fragment");
}
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  ...(url ? { datasource: { url } } : {}),
});
