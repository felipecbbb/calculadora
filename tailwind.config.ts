import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: "#10367D",
          deep: "#000926",
          accent: "#0E52B8",
          surface: "#D6E6F3",
          soft: "#A6C5D8",
          neutral: "#EBEBEB",
        },
        bg: {
          DEFAULT: "#FFFFFF",
          subtle: "#F8FAFC",
          muted: "#EBEBEB",
        },
        text: {
          DEFAULT: "#000926",
          soft: "#475569",
          muted: "#94A3B8",
          inverse: "#FFFFFF",
        },
        border: {
          DEFAULT: "#E2E8F0",
          strong: "#CBD5E1",
        },
        state: {
          success: "#10B981",
          warning: "#F59E0B",
          error: "#EF4444",
          info: "#0E52B8",
        },
      },
      fontFamily: {
        sans: ["var(--font-manrope)", "system-ui", "sans-serif"],
        display: ["var(--font-manrope)", "system-ui", "sans-serif"],
      },
      fontSize: {
        "display-1": ["clamp(2.5rem, 5vw, 4.5rem)", { lineHeight: "1.05", letterSpacing: "-0.02em", fontWeight: "800" }],
        "display-2": ["clamp(2rem, 4vw, 3.5rem)", { lineHeight: "1.1", letterSpacing: "-0.015em", fontWeight: "800" }],
        "display-3": ["clamp(1.75rem, 3vw, 2.5rem)", { lineHeight: "1.15", letterSpacing: "-0.01em", fontWeight: "700" }],
      },
      borderRadius: {
        DEFAULT: "8px",
        sm: "4px",
        md: "8px",
        lg: "12px",
        xl: "16px",
        "2xl": "20px",
      },
      boxShadow: {
        soft: "0 1px 3px rgba(0, 9, 38, 0.06), 0 1px 2px rgba(0, 9, 38, 0.04)",
        card: "0 4px 16px rgba(0, 9, 38, 0.06), 0 2px 4px rgba(0, 9, 38, 0.04)",
        elevated: "0 12px 40px rgba(0, 9, 38, 0.10), 0 4px 12px rgba(0, 9, 38, 0.06)",
      },
    },
  },
  plugins: [],
};

export default config;
