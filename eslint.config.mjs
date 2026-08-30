import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    ignores: ["out/**", "node_modules/**"],
  },
  ...tseslint.configs["flat/recommended"].map((config) => ({
    ...config,
    files: ["src/**/*.ts"],
    languageOptions: {
      ...config.languageOptions,
      parser: tsParser,
    },
  })),
];
