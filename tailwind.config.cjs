/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#F9E032',
          dark: '#D4B918',
        },
        secondary: {
          DEFAULT: '#7FC8F1',
          dark: '#5A9BD5',
          light: '#A9DDF7',
        },
      },
    },
  },
  plugins: [],
};
