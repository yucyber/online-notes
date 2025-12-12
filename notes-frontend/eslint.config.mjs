import { FlatCompat } from "@eslint/eslintrc";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
    baseDirectory: __dirname,
});

const eslintConfig = [
    {
        ignores: [".next/**", "node_modules/**", "build/**", "coverage/**"]
    },
    ...compat.extends("next/core-web-vitals", "next/typescript"),
    {
        rules: {
            "react/jsx-no-literals": "off",
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
            "jsx-a11y/alt-text": "warn",
            "jsx-a11y/click-events-have-key-events": "warn",
            "jsx-a11y/interactive-supports-focus": "warn",
            "jsx-a11y/no-autofocus": ["warn", { "ignoreNonDOM": true }],
            "jsx-a11y/label-has-associated-control": "off",
            "react-hooks/exhaustive-deps": "warn"
        }
    }
];

export default eslintConfig;
