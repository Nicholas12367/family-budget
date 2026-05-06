import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        emerald: {
          50: "#ecfdf5",
          500: "#10b981",
          600: "#059669",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
