module.exports = {
  darkMode: "class",
  content: ["./index.html", "./renderer.js"],
  theme: {
    extend: {
      colors: {
        primary: "#5668d8",
        "on-primary": "#f8faff",
        "on-surface": "#273246",
        "on-surface-variant": "#5d6880",
        "primary-container": "#d8e0ff",
        "primary-fixed": "#7283e7",
        "secondary-container": "#c7d3f8",
        tertiary: "#7a8fcf",
        error: "#c54f61",
        outline: "#7e89a2",
        "surface-container": "#dfe6f6",
        "surface-container-highest": "#edf2fb",
        "background-start": "#e7edf9",
        "background-end": "#dde5f4",
        "sidebar-start": "#7f92d8",
        "sidebar-end": "#6d80c9",
      },
      fontFamily: {
        headline: ["Manrope", "Segoe UI", "sans-serif"],
        body: ["Manrope", "Segoe UI", "sans-serif"],
        label: ["Inter", "Segoe UI", "sans-serif"],
      },
    },
  },
  plugins: [
    require("@tailwindcss/forms"),
    require("@tailwindcss/container-queries"),
  ],
};
