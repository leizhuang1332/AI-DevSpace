import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        card: {
          DEFAULT: 'hsl(var(--card) / <alpha-value>)',
          foreground: 'hsl(var(--card-foreground) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover) / <alpha-value>)',
          foreground: 'hsl(var(--popover-foreground) / <alpha-value>)',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary) / <alpha-value>)',
          foreground: 'hsl(var(--secondary-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          foreground: 'hsl(var(--accent-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive) / <alpha-value>)',
          foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)',
        },
        brand: {
          DEFAULT: 'hsl(var(--brand))',
          50: 'hsl(var(--brand-50))',
          100: 'hsl(var(--brand-100))',
          500: 'hsl(var(--brand-500))',
          600: 'hsl(var(--brand-600))',
          700: 'hsl(var(--brand-700))',
        },
        bg: {
          DEFAULT: 'hsl(var(--bg) / <alpha-value>)',
          elevated: 'hsl(var(--bg-elevated) / <alpha-value>)',
          subtle: 'hsl(var(--bg-subtle) / <alpha-value>)',
        },
        text: {
          1: 'hsl(var(--text-1) / <alpha-value>)',
          2: 'hsl(var(--text-2) / <alpha-value>)',
          3: 'hsl(var(--text-3) / <alpha-value>)',
        },
        success: {
          DEFAULT: 'hsl(var(--success-500) / <alpha-value>)',
          foreground: 'hsl(var(--success-500) / <alpha-value>)',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning-500) / <alpha-value>)',
          foreground: 'hsl(var(--warning-500) / <alpha-value>)',
        },
        error: {
          DEFAULT: 'hsl(var(--error-500) / <alpha-value>)',
          foreground: 'hsl(var(--error-500) / <alpha-value>)',
        },
        info: {
          DEFAULT: 'hsl(var(--info-500) / <alpha-value>)',
          foreground: 'hsl(var(--info-500) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'hsl(var(--border) / <alpha-value>)',
          strong: 'hsl(var(--border-strong) / <alpha-value>)',
        },
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
      },
      spacing: {
        '1': 'var(--space-1)',
        '2': 'var(--space-2)',
        '3': 'var(--space-3)',
        '4': 'var(--space-4)',
        '5': 'var(--space-5)',
        '6': 'var(--space-6)',
        '8': 'var(--space-8)',
        '10': 'var(--space-10)',
        '12': 'var(--space-12)',
      },
      fontSize: {
        xs:    ['var(--text-xs)',   { lineHeight: 'var(--leading-tight)' }],
        sm:    ['var(--text-sm)',   { lineHeight: 'var(--leading-tight)' }],
        base:  ['var(--text-base)', { lineHeight: 'var(--leading-normal)' }],
        md:    ['var(--text-md)',   { lineHeight: 'var(--leading-normal)' }],
        lg:    ['var(--text-lg)',   { lineHeight: 'var(--leading-normal)' }],
        xl:    ['var(--text-xl)',   { lineHeight: 'var(--leading-normal)' }],
        '2xl': ['var(--text-2xl)',  { lineHeight: 'var(--leading-normal)' }],
        '3xl': ['var(--text-3xl)',  { lineHeight: 'var(--leading-normal)' }],
        '4xl': ['var(--text-4xl)',  { lineHeight: 'var(--leading-normal)' }],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      fontFamily: {
        sans: 'var(--font-sans)',
        mono: 'var(--font-mono)',
      },
      /**
       * 浮动层 z-index 命名(analyzing-fab 规划包 ticket 01 / ticket 08 ·
       * ADR-0022 决策 88)。统一从命名取,避免组件里散落 z-[30] / z-[40]
       * 这类魔数:
       * - fab: 浮动召唤按钮(FAB)。比正文高,比面板 / 弹层低。
       * - panel: FAB / Cmd+K 召唤的浮动面板(历史分析面板、命令面板等)。
       *   比 FAB 高,比全屏遮罩低。
       * - overlay: 二次确认 / 全屏遮罩(删除 Run 对话框、Cmd+K 的 dim 蒙层
       *   等)。比面板高,比真正模态低。
       * - modal: 真正模态(若未来引入 full-screen 阻断型弹窗)。保留位以避
       *   免后续 ticket 临时发明魔数。
       */
      zIndex: {
        fab: '30',
        panel: '40',
        overlay: '50',
        modal: '60',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;