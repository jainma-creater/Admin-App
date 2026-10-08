/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eff6ff",
          100: "#dbeafe",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          900: "#1e3a8a",
        },
        gh: {
          canvas: "#0d1117",
          soft: "#010409",
          panel: "#161b22",
          raised: "#1c2128",
          border: "rgba(255,255,255,0.08)",
          border2: "rgba(255,255,255,0.16)",
          text: "#e6edf3",
          muted: "#9198a1",
          faint: "#7d8590",
          blue: "#2f81f7",
          green: "#3fb950",
          amber: "#d29922",
          orange: "#db6d28",
          red: "#f85149",
          purple: "#bc8cff",
          cyan: "#58a6ff",
        },
      },
      fontFamily: {
        mono: [
          "SFMono-Regular",
          "ui-monospace",
          "SFMono-Medium",
          "Menlo",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
      },
      boxShadow: {
        glass: "inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 32px rgba(1,4,9,0.45)",
        "glass-hover": "inset 0 1px 0 rgba(255,255,255,0.06), 0 12px 40px rgba(1,4,9,0.6)",
        glow: "0 0 0 1px rgba(47,129,247,0.35), 0 0 24px rgba(47,129,247,0.18)",
      },
    },
  },
  plugins: [],
};