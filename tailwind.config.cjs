/** @type {import('tailwindcss').Config} */

// Brand palette (Dair Sharaf): pencil yellow + sky blue, with a deep ink navy for structure.
const brand = {
  yellow: '#F9E032',
  yellowDark: '#D4B918',
  yellowLight: '#FDF3A6',
  sky: '#7FC8F1',
  skyDark: '#5A9BD5',
  skyLight: '#A9DDF7',
  ink: '#14213D',
};

module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: brand.yellow,
          dark: brand.yellowDark,
          light: brand.yellowLight,
        },
        secondary: {
          DEFAULT: brand.sky,
          dark: brand.skyDark,
          light: brand.skyLight,
        },
        // The codebase writes `text-primary-DEFAULT` / `bg-secondary-DEFAULT` (71 places). Tailwind only generates
        // `text-primary` for a nested DEFAULT key, so those classes produced no CSS. These flat aliases make the
        // existing class names work without editing every component.
        'primary-DEFAULT': brand.yellow,
        'secondary-DEFAULT': brand.sky,
        ink: {
          DEFAULT: brand.ink,
          soft: '#2A3A5C',
        },
      },
      // Readability: the brand sky (#7FC8F1) is too light for text on white (~1.9:1) and for white text on it.
      // Text and solid backgrounds that carry white text use a deeper sky; borders, rings and gradients keep the
      // brand sky.
      textColor: {
        'secondary-DEFAULT': '#1F6FA3',
      },
      backgroundColor: {
        'secondary-DEFAULT': '#1F78B4',
      },
      fontFamily: {
        // `font-heading` is used in 17 places but was never defined.
        heading: ['Cairo', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
