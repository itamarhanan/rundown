import { defineConfig } from "vitest/config";

const conditions = ["@rundown/source", "module", "node", "import", "default"];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions, externalConditions: ["@rundown/source"] } },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
  },
});
