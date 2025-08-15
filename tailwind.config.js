/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./views/**/*.html', './public/js/**/*.js'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'git-blue': '#0366d6',
        'git-green': '#28a745',
        'git-red': '#d73a49',
        'git-orange': '#f66a0a',
        'git-purple': '#6f42c1',
        'dark-bg': '#0d1117',
        'dark-bg-secondary': '#161b22',
        'dark-border': '#21262d',
        'dark-text': '#f0f6fc',
        'dark-text-secondary': '#8b949e',
      },
      fontFamily: {
        'mono': ['SFMono-Regular', 'Consolas', 'Liberation Mono', 'Menlo', 'monospace'],
      }
    },
  },
  plugins: [],
}
