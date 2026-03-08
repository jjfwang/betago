import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        /** Board and stone palette */
        board: {
          wood: "#dcb468",
          line: "#8b6914",
          star: "#5a3e10",
        },
        stone: {
          black: "#1a1a1a",
          white: "#f5f5f0",
          "black-shadow": "#000000",
          "white-shadow": "#c0bdb0",
        },
        /** UI surface palette – warm parchment tones matching the existing design */
        surface: {
          DEFAULT: "#fef5e5",
          muted: "#f6f0e7",
          card: "rgba(255,250,240,0.92)",
        },
        ink: {
          DEFAULT: "#171614",
          muted: "rgba(23,22,20,0.7)",
          faint: "rgba(23,22,20,0.25)",
        },
        danger: "#a3342f",
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
      borderRadius: {
        pill: "999px",
        card: "16px",
      },
      boxShadow: {
        card: "0 10px 28px rgba(63,45,31,0.14)",
      },
    },
  },
  plugins: [],
};

export default config;
