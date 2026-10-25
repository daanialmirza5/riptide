/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
        display: ["'Space Grotesk'", "Inter", "sans-serif"],
      },
      colors: {
        abyss: { 950: "#03060c", 900: "#060b16", 800: "#0b1324", 700: "#111c33", 600: "#1a2845" },
        tide: { 300: "#7dd3fc", 400: "#38bdf8", 500: "#0ea5e9" },
        glow: { cyan: "#22d3ee", violet: "#a78bfa" },
        ok: "#34d399",
        warn: "#fbbf24",
        crit: "#fb923c",
        down: "#f43f5e",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(56,189,248,.15), 0 10px 40px -10px rgba(14,165,233,.35)",
      },
      keyframes: {
        pulseRing: { "0%": { transform: "scale(.9)", opacity: ".7" }, "100%": { transform: "scale(1.6)", opacity: "0" } },
        shimmer: { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
      },
      animation: {
        pulseRing: "pulseRing 1.6s ease-out infinite",
        shimmer: "shimmer 2.4s linear infinite",
      },
    },
  },
  plugins: [],
};
