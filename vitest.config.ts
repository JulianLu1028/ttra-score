import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Domain, SSR and database tests do not need CSS processing or browser plugins.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    environment: "node",
    pool: "threads",
    maxWorkers: 1,
    fileParallelism: false,
  },
});
