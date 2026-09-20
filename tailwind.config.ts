import type { Config } from "tailwindcss";

// Brand tokens come from the CSS custom properties in src/styles/globals.css so a
// tone can be adjusted once (see the frontend PRD §7.1 token contract).
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        maroon: "var(--color-maroon)",
        "maroon-dark": "var(--color-maroon-dark)",
        "vt-orange": "var(--color-orange)",
        warm: "var(--color-bg-warm)",
        panel: "var(--color-panel)",
        "soft-maroon": "var(--color-soft-maroon)",
        "ink-primary": "var(--color-text-primary)",
        "ink-secondary": "var(--color-text-secondary)",
        line: "var(--color-border)",
        success: "var(--color-success)",
        warning: "var(--color-warning)",
        danger: "var(--color-danger)",
        info: "var(--color-info)",
        "success-soft": "var(--color-success-soft)",
        "warning-soft": "var(--color-warning-soft)",
        "danger-soft": "var(--color-danger-soft)",
        "info-soft": "var(--color-info-soft)",
      },
      fontFamily: {
        sans: ['"Inter"', '"Source Sans 3"', "system-ui", "-apple-system", '"Segoe UI"', "sans-serif"],
      },
      boxShadow: {
        card: "var(--shadow-card)",
        "card-lg": "var(--shadow-card-lg)",
      },
    },
  },
  plugins: [],
} satisfies Config;
