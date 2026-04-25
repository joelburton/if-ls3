import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      // Allow `any` when unavoidable (e.g. JSON.parse, catch clauses)
      "@typescript-eslint/no-explicit-any": "off",
      // Non-null assertions are used deliberately throughout
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    ignores: ["out/**", "node_modules/**"],
  },
);
