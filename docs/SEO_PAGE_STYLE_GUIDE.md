# RecoveryStack SEO Page Style Guide — CSS & Design System

Generate HTML pages that match the following design system exactly. Every page should feel like it belongs on recoverystack.io — dark premium sports-tech aesthetic with clean typography and sky-blue accents.

## Fonts

- Primary: "Geist", "Inter", system-ui, sans-serif
- Monospace (for data/stats): "Geist Mono", monospace
- Base size: 16px
- Use font-smoothing: antialiased

## Color Palette

- Page background: `#06090f` (near-black, NOT pure black)
- Card/section backgrounds: `#0f172a` (slate-950)
- Card borders: `rgba(255, 255, 255, 0.08)` or `1px solid #1e293b`
- Primary text: `#ffffff`
- Secondary text: `#94a3b8` (slate-400)
- Muted text: `#64748b` (slate-500)
- Dim text: `#475569` (slate-600)
- Accent/brand: `#0ea5e9` (sky-500)
- Accent hover: `#38bdf8` (sky-400)
- Accent gradient: `linear-gradient(to right, #0ea5e9, #38bdf8)`
- Success/positive: `#34d399` (emerald-400)
- Category tag backgrounds: soft pastel tints
  - blue tags: bg `#dbeafe`; color `#1d4ed8`
  - violet tags: bg `#e0e7ff`; color `#4338ca`

## Layout

- Max content width: `max-width: 1280px` (7xl), centered
- Horizontal padding: `24px` mobile, `32px` desktop
- Section vertical padding: `56px` to `80px`
- Use CSS Grid or Flexbox. Never floats.
- Article body max-width: `720px` centered

## Typography Scale

- h1: `2.25rem` (36px) to `3rem` (48px), `font-weight: 800`, `letter-spacing: -0.025em`, white
- h2: `1.5rem` (24px), `font-weight: 700`, white
- h3: `1.125rem` (18px), `font-weight: 600`, white
- Body: `0.875rem` (14px) to `1rem` (16px), `line-height: 1.75`, `#94a3b8`
- Meta/small: `0.75rem` (12px), `font-weight: 600`, uppercase, tracking `0.1em`, `#64748b`
- Gradient text emphasis:
  - `background: linear-gradient(to right, #0ea5e9, #38bdf8)`
  - `-webkit-background-clip: text`
  - `color: transparent`

## Buttons

- Primary CTA:
  - background: `#0ea5e9`
  - color: white
  - border-radius: `9999px`
  - padding: `12px 24px`
  - font-weight: `600`
  - font-size: `14px`
  - hover: `#0284c7`
  - shadow: `0 4px 20px rgba(14, 165, 233, 0.25)`
- Secondary/outline:
  - border: `1px solid rgba(255,255,255,0.15)`
  - color: `#cbd5e1`
  - border-radius: `9999px`
  - padding: `12px 24px`
  - font-size: `14px`
  - hover: `#1e293b`

## Cards

- Background: `#0f172a` or `rgba(15, 23, 42, 0.6)`
- Border: `1px solid rgba(255, 255, 255, 0.06)`
- Radius: `16px` (`rounded-2xl`)
- Padding: `24px`
- Hover:
  - border-color: `rgba(14, 165, 233, 0.2)`
  - box-shadow: `0 4px 16px rgba(14, 165, 233, 0.05)`
- Transition: `all 0.3s ease`

## Category Tags (Inline Badges)

- `display: inline-flex`
- `border-radius: 9999px`
- `padding: 2px 10px`
- `font-size: 11px`
- `font-weight: 600`
- `border: 1px solid`
- Use light-on-dark tints by category

## Images

- `border-radius: 12px`
- `object-fit: cover`
- Aspect ratio containers:
  - hero: `16/9`
  - thumbnail: `1/1`
- Hero overlay gradient: `linear-gradient(to top, #06090f, transparent)`

## Navigation Bar (Sticky Top)

- Background: white
- Border-bottom: `1px solid #f1f5f9`
- Height: `64px`
- Logo text:
  - "RECOVERYSTACK"
  - `font-weight: 900`
  - `font-size: 14px`
  - `letter-spacing: -0.025em`
  - `color: #0f172a`
- Nav links:
  - `font-size: 14px`
  - `font-weight: 500`
  - `color: #64748b`
  - hover: `#0f172a`

## Footer

- Background: `#0f172a`
- Border-top: `1px solid #1e293b`
- Padding: `64px` vertical
- Section headers:
  - `font-size: 12px`
  - `font-weight: 600`
  - uppercase
  - tracking `0.1em`
  - `color: #64748b`
- Links:
  - `font-size: 14px`
  - `color: #94a3b8`
  - hover: white
- Columns: Product, Company, Support, Legal
- Footer tagline: "Clinical-grade sleep intelligence for elite performers."

## Page Structure Template for SEO articles

(Provided by user; to be enforced by generator/template renderer.)
