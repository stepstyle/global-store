/** @type {import('tailwindcss').Config} */

// Dair Sharaf — "Scholar" identity: deep ink navy (structure, trust), refined gold (premium accent, pencil heritage),
// warm paper cream (backgrounds) and a royal blue for links / interactive accents.
// The existing components use `primary` (was pencil yellow), `secondary` / `sky` (was sky blue) everywhere: redefining
// those scales here restyles the whole site consistently — checkout and dashboard included — without touching logic.
const ink = { 50: '#F2F4F8', 100: '#E1E6EF', 200: '#C3CCDD', 300: '#94A3BF', 400: '#64769A', 500: '#45577D', 600: '#2F4066', 700: '#22325A', 800: '#172548', 900: '#0F1B38', 950: '#0A1227' };
const gold = { 50: '#FBF7EC', 100: '#F6EBCB', 200: '#ECD59A', 300: '#E0BC69', 400: '#D4A645', 500: '#C08A2B', 600: '#A06F1F', 700: '#7E571A', 800: '#5E4116', 900: '#3F2C10' };
const royal = { 50: '#EEF3FA', 100: '#DCE7F4', 200: '#B7CDE8', 300: '#88ACD7', 400: '#5786C1', 500: '#3567A8', 600: '#28528C', 700: '#204272', 800: '#1B375E', 900: '#172E4E', 950: '#0E1D33' };
const paper = { DEFAULT: '#FAF7F1', 50: '#FFFDF9', 100: '#FAF7F1', 200: '#F3EDE1', 300: '#E8DFCC' };

module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { ...ink, DEFAULT: ink[900], soft: ink[700] },
        gold: { ...gold, DEFAULT: gold[500] },
        paper,
        royal: { ...royal, DEFAULT: royal[600] },
        // existing class names, new identity
        sky: royal,
        // purple / indigo accents of older components (finder, checkout, CliQ, dashboard) join the identity too
        indigo: royal,
        violet: royal,
        purple: ink,
        black: ink[950],
        primary: { DEFAULT: gold[400], dark: gold[600], light: gold[100] },
        secondary: { DEFAULT: royal[500], dark: royal[700], light: royal[100] },
        'primary-DEFAULT': gold[400],
        'secondary-DEFAULT': royal[600],
      },
      textColor: { 'secondary-DEFAULT': royal[600] },
      backgroundColor: { 'secondary-DEFAULT': ink[900] },
      fontFamily: {
        sans: ['"IBM Plex Sans Arabic"', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Arial', 'sans-serif'],
        heading: ['"Readex Pro"', '"IBM Plex Sans Arabic"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 1px 2px rgba(15,27,56,0.04), 0 8px 24px -12px rgba(15,27,56,0.12)',
        lift: '0 2px 4px rgba(15,27,56,0.04), 0 24px 48px -20px rgba(15,27,56,0.28)',
        gold: '0 10px 30px -10px rgba(192,138,43,0.45)',
      },
      borderRadius: { '4xl': '2rem' },
      backgroundImage: {
        'paper-grain': 'radial-gradient(rgba(15,27,56,0.035) 1px, transparent 1px)',
        'ink-glow': 'radial-gradient(1200px 500px at 85% -10%, rgba(53,103,168,0.35), transparent 60%), radial-gradient(800px 400px at 0% 110%, rgba(192,138,43,0.25), transparent 60%)',
      },
    },
  },
  plugins: [],
};
