/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      boxShadow: {
        float: '0 24px 80px rgba(2, 6, 23, .12)',
        card: '0 1px 1px rgba(15, 23, 42, .04), 0 8px 24px rgba(15, 23, 42, .04)',
      },
    },
  },
  plugins: [],
}
