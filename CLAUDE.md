# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Local Development

Start a local HTTP server on port 8090:

```bash
python3 -m http.server 8090 --directory /home/user/ai-design-yammy
```

Then open `http://localhost:8090` in a browser. There is no build step, no npm, and no test suite.

## Architecture

This is a single-file static landing page for **AIデザイン教室 YAMMY** — a one-on-one AI practical training service by instructor 山名 浩実.

### `index.html` structure

All CSS lives in a `<style>` block in `<head>`. All JavaScript lives in a `<script>` block at the end of `<body>`. Sections in order:

| Section | ID / class | Purpose |
|---|---|---|
| Header | `#header` | Fixed nav with scroll shadow + hamburger for mobile |
| Hero | `.hero` | Dark starfield hero with canvas animation + CSS shooting stars |
| Problems | `#problems` | 3-column pain-point cards |
| Courses | `#courses` | 2 course cards + consultation card |
| Features | `#features` | 3-column "Why YAMMY" cards |
| Content | (no id) | 3-column course content areas |
| Profile | `#profile` | Instructor bio on dark background |
| Reviews | `#reviews` | 3-column testimonial cards |
| CTA | `.cta` | Call-to-action with booking links |
| Footer | `footer` | Logo + external links + copyright |

### CSS design tokens (`:root`)

Primary color `--primary: #3b82f6`, accent `--accent: #f59e0b`, dark background `--dark: #030712`. All spacing, shadow, and radius values are defined as CSS variables at the top of the `<style>` block.

Responsive breakpoint is **768px** — collapses all multi-column grids to single column and shows the hamburger menu.

### JavaScript

Three independent behaviors:

1. **Header scroll shadow** — toggles `.scrolled` class on `#header` via `scroll` event
2. **Canvas starfield** — IIFE in the hero; draws 300 distant stars + 40 bright twinkling stars with glow using `requestAnimationFrame`. Reinitializes on window resize.
3. **Scroll fade-in** — `IntersectionObserver` adds `.visible` to `.fade-in` elements at 10% threshold

### External dependencies

- Google Fonts: Noto Sans JP + Inter (loaded via `<link>`)
- Booking links and profile image point to `street-academy.com` (ストアカ)
- Consultation card image hosted on `stacademy-images.s3.amazonaws.com`

### Local assets

| File | Usage |
|---|---|
| `logo.png` | Header and footer logo |
| `favicon.png` | Browser tab icon |
| `course1.jpg` | スライド爆速講座 card image |
| `course2.png` | Google AI戦略講座 card image |
