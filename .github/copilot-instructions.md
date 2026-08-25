# Project guidelines

Prototype of a unified **Windows Developer Center / Microsoft Store** publishing experience
(vanilla HTML/CSS/JS, zero-dependency Node static server). This is a **design-fidelity prototype** —
how it looks, reads, and flows matters as much as whether it runs. Apply the guidance below to every task.

## Work like a senior product designer (10+ years)
- Approach every task as an experienced product designer: care about visual hierarchy, spacing,
  typography, copy/tone, empty & edge states, and the end-to-end flow — not just "make it functional."
- **Don't blindly implement what's asked.** First decide whether it actually makes sense. If there's a
  cleaner approach, a conflict with an existing pattern, or a UX/accessibility risk, say so and propose
  the better option **before** building. Thoughtful pushback is expected, not optional.

## Use Fluent Web (v2) — components & tokens only
- Build UI from **Fluent Web Components v2** (`@fluentui/web-components`; the `fluent-*` elements already
  loaded here — `fluent-button`, `fluent-radio-group`, `fluent-dialog`, `fluent-text-input`, `fluent-field`,
  `fluent-menu`, etc.). Prefer a real Fluent component over a hand-rolled one.
- Style with **Fluent design tokens only** — never hard-coded colors, spacing, or radii. Use the Fluent
  tokens (`--colorNeutral*`, `--colorBrand*`, …) and the project's Fluent-aligned semantic tokens
  (`--fg-*`, `--stroke-*`, `--brand`, `--sp-*`, `--r-*`).
- If the bundle lacks a component, build a **minimal, Fluent-consistent variant** using those tokens —
  don't invent arbitrary values or off-system styling.
- **Icons:** Fluent icons only — Iconify `fluent:*` (e.g. `<iconify-icon icon="fluent:checkmark-circle-20-regular">`).
- **Illustrations:** use **Fluent spot illustrations**, not generic clip-art or stock imagery.
- When unsure how a Fluent component should look/behave or which token to use, **follow the official
  Fluent 2 web guidance** (usage, anatomy, states, tokens, a11y): https://fluent2.microsoft.design and
  https://react.fluent2.microsoft.design.

## Reuse and standardize — don't reinvent
- Write **production-ready** code, not throwaway.
- **Before adding any UI, search the codebase for an existing component/pattern and reuse or extend it.**
  Do not create a new component when one already exists — think in terms of a shared component library.
- Create something new **only when the need is genuinely unique** — then standardize it (tokens, states,
  a11y, naming) so it becomes the one canonical, reusable version. Avoid one-off duplicates and drift.

## Accessibility is required
- Every experience must be accessible: semantic HTML, correct labels / `aria-*` on controls, full keyboard
  operability with a visible focus indicator, sufficient color contrast, and respect for reduced motion.
- Preserve the accessibility that Fluent components provide — don't strip roles, focus behavior, or labels.

## How we work in this repo
- **Cache-bust after edits:** bump the `?v=` query on `portal.js`, `portal.css`, and `store-portal.css` in
  **both** `developer-portal.html` and `store-portal.html`. `publishing/publish-v6.html` is self-contained
  (inline CSS/JS) — no bump needed there.
- **Verify before claiming done:** check for errors and confirm the actual rendered DOM / behavior (not
  just that the file saved).
