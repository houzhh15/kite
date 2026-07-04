// PostCSS config for KITE.
// Order matters: Tailwind processes @tailwind directives first, then
// autoprefixer adds vendor prefixes.
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
