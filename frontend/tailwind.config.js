/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: "#f3f7fb",
        ink: "#142132",
        accent: "#0f7cff",
        accentDark: "#0b5fcc",
        cyanGlow: "#75d5ff",
        success: "#1f9d68",
        warn: "#c58917",
        danger: "#c84b58",
      },
      boxShadow: {
        panel: "0 18px 50px rgba(20, 33, 50, 0.08)",
        soft: "0 12px 30px rgba(15, 124, 255, 0.08)",
      },
      backgroundImage: {
        grid: "linear-gradient(rgba(17, 24, 39, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(17, 24, 39, 0.05) 1px, transparent 1px)",
      },
    },
  },
  plugins: [],
};

