# ArcaneClash Visual Redesign Roadmap

**Audience:** Claude Opus 4.8 (or any agent executing the redesign).
**Goal:** Redesign the entire game's visual layer around a flat, Tarot-proportioned,
stained-glass / watercolor card design whose border and theme change with rarity.
Gameplay rules, networking, and the engine stay untouched.

---

## 1. The design brief (source of truth — follow verbatim)

> Please implement the design using the following structural and visual rules,
> ensuring the card's border and theme dynamically reflect its RARITY tier:
>
> **1. TAROT CARD DIMENSIONS & FLAT STRUCTURE:**
> - Use a distinct Tarot card aspect ratio (strictly 1:1.75, roughly a Tailwind
>   width of w-64 and height of h-[448px] / h-112).
> - NO BEVELS, NO EMBOSSING, AND NO SHADOWS. The design must be completely flat
>   2D, relying entirely on clean graphic shapes.
> - The outer stained-glass border and frame lines must change color based on
>   the card's rarity to clearly indicate its value at a glance.
> - Symmetrical, elegant Art Nouveau linework or a gothic archway geometry
>   framing the central artwork container to emphasize the tall vertical space.
>
> **2. DYNAMIC RARITY THEME SYSTEM:**
> Set up the component to accept a rarity prop (Common, Rare, Legendary).
> Implement distinct flat watercolor and border palettes for each tier:
> - COMMON: Solid dark charcoal/black lead lines. The watercolor panes use
>   muted, earthy tones (pale moss greens, misty greys, soft sepia, and washed blues).
> - RARE: Sleek, deep indigo or dark silver flat line borders. The watercolor
>   panes shift to vibrant, mystical jewel tones (deep sapphire, amethyst
>   purple, and pale rose pink).
> - LEGENDARY: A prominent, flat matte gold/amber line border. The watercolor
>   panes use rich, dramatic gradients (blazing sun gold, deep ruby red, and
>   ethereal twilight orange).
>
> **3. FLAT STAINED-GLASS & WATERCOLOR AESTHETIC (CSS/SVG):**
> - Use nested containers or sharp inline SVG paths to create a segmented
>   "pane" effect for the background.
> - For the colors inside the segments, use flat, soft, semi-translucent CSS
>   gradients that mimic matte, washed watercolor paints.
> - DO NOT use box-shadows or 3D inner glows. The "luminous" quality should
>   come purely from the choice of bright, contrasting watercolor colors
>   against the solid rarity-themed borders.
>
> **4. UI ELEMENTS & TYPOGRAPHY:**
> - Include an ornamental header or geometric segment at the top for a Roman
>   numeral or resource cost, matching the rarity's border color.
> - A distinct, stylized title banner/ribbon near the bottom of the card using
>   an elegant, readable serif typeface with high contrast.
> - A clean, solid-color or slightly opaque matte rules text box at the very
>   bottom that ensures high gameplay readability.
>
> **5. INTERACTIVITY:**
> - For the hover state, DO NOT lift or shadow the card. Instead, create a
>   flat transition—such as a clean color shift or subtle pulse in the rarity
>   borders, or a crisp flat line overlay that triggers on hover.

---

## 2. Where cards render today (all must converge on one design)

| Surface | File | Tech | Today |
| --- | --- | --- | --- |
| In-match board & hand | `packages/client/src/game/board.ts` (~1030 lines) | PixiJS `Graphics` + textures | Full-bleed art, rarity-colored inner frame via `rarityColor()` / `RARITY_COLORS`, status border (selected/actable/taunt), card back in `drawCardBack()` |
| Deck builder tiles | `packages/client/src/DeckBuilder.tsx` → `CardFace` | DOM + CSS (`.cardface`, `.rarity-*` in `styles.css`) | Compact tile, rarity CSS classes already exist |
| Mulligan overlay | `packages/client/src/App.tsx` → `MulliganOverlay` | Inline DOM markup (`.cf-*` classes) | Duplicated ad-hoc card markup |
| Card art | `packages/client/src/game/cardart.ts` | Vite glob of `src/art/<defId>.png` | Procedural pixel-art fallback in `pixelart.ts` |
| App chrome | `App.tsx` (menu, account panel, end screen), `DeckBuilder.tsx`, `styles.css` (~690 lines) | DOM + CSS | Generic dark theme, unstyled relative to the new aesthetic |

Rarity is already in the engine: `CardDef.rarity` in `packages/engine/src/types.ts` is
`"basic" | "common" | "rare" | "epic" | "legendary"` (optional, defaults to common).
The client always has the `defId` for visible cards, so rarity is derivable via
`getCardDef()` — **no engine or server changes are required.**

## 3. Decisions made up front (do not re-litigate; implement these)

1. **Rarity mapping — 5 engine tiers onto the 3-tier brief.** Define five
   palettes in one theme module: `basic` and `common` both use the COMMON
   charcoal/earthy palette (optionally `basic` slightly more muted), `rare`
   uses the RARE indigo/jewel palette, `epic` uses a derived tier between
   Rare and Legendary (deep amethyst/dark-silver borders, violet-and-rose
   panes — same flat rules), `legendary` uses the LEGENDARY gold/amber palette.
2. **No Tailwind.** The repo uses plain CSS (`styles.css`). Translate the
   brief's sizing to CSS custom properties: base card = **256 × 448 px**
   (exactly 1:1.75); every other size derives from a `--card-w` variable so
   the card scales (deck builder tiles, mulligan, inspection) via a single
   `transform: scale()` or container-relative units. Do not add a CSS framework.
3. **One source of truth for the frame: an inline SVG React component**
   (`<TarotCard>`), plus a plain-TS theme module consumed by BOTH the React
   component and the PixiJS board (Pixi needs numeric hex colors; CSS needs
   strings — export both from one place).
4. **PixiJS board stays.** Do not rewrite the renderer in DOM. Bridge the
   design into Pixi by rasterizing the SVG frame per rarity into cached
   `PIXI.Texture`s (serialize the SVG string → `PIXI.Texture.from(dataURI)`),
   one texture per (rarity × card type), reused by every card sprite. Art,
   stats, and text remain separate Pixi layers on top, exactly as now.
5. **Flat status language.** Selected / actable / taunt / frozen indicators in
   `board.ts` currently use extra border colors and glows. Replace glows with
   flat treatments that cannot be confused with rarity: e.g. a crisp dashed or
   double outer line for "can act", a solid heavy slate arch for taunt, a flat
   pale-blue pane tint for frozen. Remove every `box-shadow`, Pixi glow, and
   alpha-blur effect across the whole client.
6. **Typography.** Self-host a serif display face (e.g. `@fontsource/cormorant-garamond`
   for titles + `@fontsource/eb-garamond` or system serif for rules text) so the
   game keeps working offline; no CDN links. Wire the same family into Pixi
   text styles.
7. **Roman numeral cost.** Costs 1–10 render as I–X in the ornamental top
   cartouche; cost 0 renders as "0" (Roman has no zero — keep it readable).
   Show the Arabic number as a small secondary glyph if playtesting shows
   I–X reads too slowly, but start Roman-only per the brief.

## 4. Phases

Each phase must end green: `npm run typecheck && npm test`, plus `npm run dev`
visual check. Commit per phase.

### Phase 0 — Design tokens & theme module
- New file `packages/client/src/game/theme.ts`: for each of the 5 rarities,
  export border color, line-work color, hover/pulse color, and 3–4 watercolor
  pane gradient stops — each as both CSS string and numeric hex.
  Also export card dimension constants (256×448, corner geometry, inset widths).
- Replace `RARITY_COLORS` in `board.ts` and `.rarity-*` colors in `styles.css`
  with values from this module (CSS via custom properties injected once).

### Phase 1 — The `<TarotCard>` component
- New file `packages/client/src/TarotCard.tsx`: inline SVG implementing the
  full brief — stained-glass segmented background panes (sharp SVG paths,
  semi-translucent flat gradients), symmetrical Art Nouveau / gothic-arch
  frame around the art window, rarity-colored border and linework, ornamental
  cost cartouche (Roman numerals), serif title ribbon, matte rules-text box,
  attack/health gems for minions (flat shapes, no shadows), keyword badges.
- Props: `def: CardDef`, `size` (scale factor), `artUrl?` (reuse the URL map —
  export a `cardArtUrl(defId)` helper from `cardart.ts`), flags for
  `selected` / `disabled` / `count`.
- Hover: flat border color-shift or pulse animation only (CSS `@keyframes` on
  stroke color / a crisp overlay line) — no transform lift, no shadow.
- Spells vs minions: same frame family; spells omit stat gems and may use an
  alternate central pane arrangement.
- Add a dev-only gallery (e.g. `?gallery` query param branch in `App.tsx`)
  rendering every collectible card at full size grouped by rarity, for visual QA.

### Phase 2 — DOM surfaces adopt `<TarotCard>`
- `DeckBuilder.tsx`: replace `CardFace` with scaled `<TarotCard>`; restyle the
  builder chrome (hero picker, mana curve, deck list) with the same tokens.
- `App.tsx` `MulliganOverlay`: replace the inline `.cf-*` markup with
  `<TarotCard>`; the REPLACE marker becomes a flat overlay line/stamp.
- Delete the now-dead `.cardface` / `.cf-*` CSS.

### Phase 3 — PixiJS board integration
- New `packages/client/src/game/cardframes.ts`: builds and caches the
  per-rarity frame textures from the same SVG geometry (share path data with
  `TarotCard.tsx` — put the raw SVG-string builder in a shared module so React
  and Pixi render identical frames).
- `board.ts`: hand cards and board minions use the frame textures + theme
  tokens; keep the 1:1.75 ratio for hand cards (board minions may stay
  squarer — if so, derive a compact "board pane" variant from the same
  geometry, same rarity borders). Redraw `drawCardBack()` as a flat
  stained-glass rose/arch motif. Restyle hero frames, hero power button, end
  turn button, mana crystals, and the targeting arrow to the flat language.
  Replace every glow/aura (`frameAura`, selection glow, freeze overlay) with
  flat pulses/tints per decision #5.
- Keep all tween/animation logic (`tween.ts`) — only visuals change.

### Phase 4 — Full app chrome
- Menu, account panel, deck list screen, battle log, overlays, buttons, end
  screen: restyle in `styles.css` to match — parchment-dark flat background,
  Art Nouveau rules/dividers, serif headings, rarity-neutral indigo/charcoal
  chrome so the cards stay the most colorful objects on screen.
- `index.html`: title font preload, background color to kill white flash.

### Phase 5 — Polish & verification
- Hover/pulse pass on every interactive element (flat only).
- Legibility pass: rules text ≥ 12px effective at deck-builder scale; verify
  colorblind-distinguishable rarity borders (charcoal / indigo / amethyst /
  gold differ in lightness, not just hue).
- Run `npm run typecheck && npm test && npm run smoke`; play one full AI match,
  one hotseat match, open every screen.
- Visual checklist: no `box-shadow` / `drop-shadow` / Pixi blur anywhere;
  card ratio exactly 1:1.75; rarity obvious from 2 meters away.

## 5. Out of scope
- Engine (`packages/engine`) and server (`packages/server`) code.
- Card art generation (existing `src/art/` images + pixel fallback stay; the
  new frame just crops them into the arch window — note in `cardart.ts` that
  portrait ~3:4 sources still work).
- New gameplay features, sounds, or balance changes.
