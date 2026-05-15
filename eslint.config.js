import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    files: ["src/**/*.ts"],
    ignores: ["src/**/__tests__/**"],
    languageOptions: { parser: tseslint.parser },
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["**/durable/*", "!**/durable/index*"],   message: "Cross-layer imports must go through durable/index.js" },
          { group: ["**/interview/*", "!**/interview/index*"], message: "Cross-layer imports must go through interview/index.js" },
          { group: ["**/phases/*", "!**/phases/index*"],    message: "Cross-layer imports must go through phases/index.js" },
          { group: ["**/skill/*", "!**/skill/index*"],     message: "Cross-layer imports must go through skill/index.js" },
        ],
      }],
    },
  },
  {
    files: ["src/**/__tests__/**/*.ts"],
    languageOptions: { parser: tseslint.parser },
  },
);
