/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        background: "#09090b",
        foreground: "#fafafa",
        primary: "#a855f7",
        "primary-foreground": "#fafafa",
        secondary: "#27272a",
        "secondary-foreground": "#fafafa",
        muted: "#27272a",
        "muted-foreground": "#a1a1aa",
        border: "#27272a",
        card: "#18181b",
        "card-foreground": "#fafafa",
        destructive: "#ef4444",
        amber: { 500: "#f59e0b" },
        emerald: { 500: "#10b981", 600: "#059669" },
        blue: { 500: "#3b82f6" },
        rose: { 500: "#f43f5e" },
        orange: { 500: "#f97316" },
        violet: { 500: "#8b5cf6" },
        pink: { 500: "#ec4899" },
      },
    },
  },
  plugins: [],
};
