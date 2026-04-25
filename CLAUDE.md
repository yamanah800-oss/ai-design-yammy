# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Local Development

Start a local HTTP server on port 8090:

```bash
python3 -m http.server 8090 --directory /home/user/ai-design-yammy
```

Then open `http://localhost:8090` in a browser. There is no build step, no npm, and no test suite.

## Business Overview

**AIデザイン教室 YAMMY** は、講師・山名 浩実（CIA 公認内部監査人）が提供するマンツーマン AI 実務レッスンサービス。ターゲットは講師業・コンサル・士業・女性起業家。予約・決済はすべてストアカ（street-academy.com）経由。

### 講座・料金

| 講座名 | 料金 | 時間 | ストアカ ID |
|---|---|---|---|
| スライド爆速講座（Gemini / NotebookLM） | ¥3,000 / 回 | 90分 | `myclass/127942` |
| 経営者のためのGoogle AI戦略講座 | ¥3,000 / 回 | 90分 | `myclass/208497` |
| AI活用なんでも相談（受講生限定） | ¥1,000 / 30分 | 30分〜 | `steachers/592183` |

### よく更新されるコンテンツ

- **評価・件数** — `course-rating-number` / `course-rating-count` に記載（例: `5.0`・`（84件）`）
- **受講生累計** — Hero セクションの `.hero-stat-number`（現在 `500+`）
- **受講者の声** — `#reviews` 内の `.review-card` を追加・編集（`review-stars` / `review-text` / `review-author`）
- **ストアカ予約 URL** — `tracking_code` クエリパラメータ付き。変更時は同一講座の全リンクをまとめて更新する

### コピーのトーン

- 読み手の「悩み → 解決」の流れで語りかける
- 専門用語を避け、ひらがな・やわらかい表現を優先
- 英数字・記号は半角、文章は日本語統一

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
