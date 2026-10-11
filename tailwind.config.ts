import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 古风主题色板：纸、墨、朱砂、泥金
        ink: {
          DEFAULT: '#2b2621',
          soft: '#5b5044',
          faint: '#8f826d',
        },
        cinnabar: {
          DEFAULT: '#9c2b21',
          light: '#c0463a',
        },
        gold: '#b08d4f',
      },
      fontFamily: {
        // 正文优先宋/楷，回退到系统中文衬线
        serif: [
          '"Noto Serif SC"',
          '"Songti SC"',
          '"STSong"',
          '"SimSun"',
          'Georgia',
          'serif',
        ],
      },
      boxShadow: {
        paper: '0 1px 2px rgba(43, 38, 33, 0.06)',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};
export default config;
