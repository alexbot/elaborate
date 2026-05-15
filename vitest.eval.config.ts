import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    test: {
      globals: true,
      environment: "node",
      include: ["tests/**/*.test.ts"],
      testTimeout: 600_000,
      hookTimeout: 600_000,
      env,
    },
  };
});
