import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // La frontera con el POS: fuera de `src/lib/central/` solo se entra por su
  // índice (funciones) o por el contrato (tipos). Así nada más sabe qué POS
  // hay detrás. Ver `src/lib/central/index.ts`.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/central/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/central/*", "!@/lib/central/contract"],
              message:
                "Importa desde '@/lib/central' (funciones) o '@/lib/central/contract' (tipos): el resto de esa carpeta es interno.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
