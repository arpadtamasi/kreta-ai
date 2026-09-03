---
name: "Üzenőfüzet"
description: "A corrected school notebook: cool paper, cobalt structure, and explicit vermilion annotations for a parent-facing KRÉTA–Claude connector."
colors:
  primary-cobalt: "#113f7a"
  primary-cobalt-strong: "#073896"
  primary-cobalt-soft: "#aebfda"
  vermilion-correction: "#d64a35"
  attention-yellow: "#f2c84b"
  success-green: "#286d58"
  cool-paper: "#f4f7fb"
  bright-paper: "#fbfcfe"
  carbon-ink: "#0b121c"
  muted-ink: "#516071"
  grid-line: "rgba(17, 63, 122, .115)"
  night-surface: "#101a27"
  night-rule: "#405065"
  night-copy: "#c4ceda"
  night-meta: "#9caabe"
  credential-canvas: "#f4f5f7"
  credential-sheet: "#ffffff"
  credential-ink: "#14181f"
  credential-muted: "#626b78"
  credential-border: "#dde1e7"
  credential-field-border: "#c3cad4"
  credential-primary: "#1a56db"
  credential-secondary: "#eef1f6"
typography:
  display:
    fontFamily: '"Big Shoulders Display Variable", "Arial Narrow", sans-serif'
    fontSize: "clamp(5rem, 8vw, 9rem)"
    fontWeight: 600
    lineHeight: 0.76
    letterSpacing: "-.035em"
  headline:
    fontFamily: '"Manrope Variable", Manrope, system-ui, sans-serif'
    fontSize: "clamp(2.1rem, 4.2vw, 4.7rem)"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-.045em"
  lead:
    fontFamily: '"Manrope Variable", Manrope, system-ui, sans-serif'
    fontSize: "clamp(1.35rem, 2.2vw, 2.2rem)"
    fontWeight: 650
    lineHeight: 1.35
    letterSpacing: "-.035em"
  body:
    fontFamily: '"Manrope Variable", Manrope, system-ui, sans-serif'
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.65
  action:
    fontFamily: '"Manrope Variable", Manrope, system-ui, sans-serif'
    fontSize: ".9rem"
    fontWeight: 800
  label:
    fontFamily: '"IBM Plex Mono", monospace'
    fontSize: ".68rem"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: ".08em"
  credential-body:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: ".9rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  square: "0"
  credential-field: "8px"
  credential-notice: "10px"
  credential-group: "12px"
  credential-sheet: "18px"
  circle: "50%"
  correction-loop: "48% 53% 45% 50%"
spacing:
  micro: ".25rem"
  xs: ".5rem"
  sm: ".75rem"
  md: "1rem"
  lg: "1.4rem"
  xl: "2rem"
  page: "clamp(1.25rem, 3.8vw, 4.5rem)"
  section: "clamp(4rem, 8vw, 8rem)"
  paper-grid: "28px"
components:
  button-primary:
    backgroundColor: "{colors.primary-cobalt-strong}"
    textColor: "#ffffff"
    typography: "{typography.action}"
    rounded: "{rounded.square}"
    padding: ".95rem 1.3rem"
    height: "3.55rem"
  button-primary-hover:
    backgroundColor: "{colors.primary-cobalt}"
    textColor: "#ffffff"
    rounded: "{rounded.square}"
  button-primary-active:
    backgroundColor: "{colors.carbon-ink}"
    textColor: "#ffffff"
    rounded: "{rounded.square}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.primary-cobalt-strong}"
    typography: "{typography.action}"
    rounded: "{rounded.square}"
    padding: ".95rem 1.3rem"
    height: "3.55rem"
  pledge-textarea:
    backgroundColor: "{colors.bright-paper}"
    textColor: "{colors.carbon-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.square}"
    padding: "1rem"
    width: "100%"
  credential-input:
    backgroundColor: "{colors.credential-sheet}"
    textColor: "{colors.credential-ink}"
    typography: "{typography.credential-body}"
    rounded: "{rounded.credential-field}"
    padding: "0 12px"
    height: "42px"
    width: "100%"
  credential-button-primary:
    backgroundColor: "{colors.credential-primary}"
    textColor: "{colors.credential-sheet}"
    rounded: "{rounded.credential-field}"
    height: "44px"
    width: "100%"
  credential-button-secondary:
    backgroundColor: "{colors.credential-secondary}"
    textColor: "{colors.credential-ink}"
    rounded: "{rounded.credential-field}"
    height: "44px"
    width: "100%"
  credential-sheet:
    backgroundColor: "{colors.credential-sheet}"
    textColor: "{colors.credential-ink}"
    typography: "{typography.credential-body}"
    rounded: "{rounded.credential-sheet}"
    padding: "clamp(24px, 5vw, 40px)"
    width: "min(100%, 34rem)"
---

# Design System: Üzenőfüzet

## Overview

**Creative North Star: "The Corrected School Notebook"**

Üzenőfüzet is a cool exercise-book page made digital: pale blue-white paper, disciplined cobalt ink, ledger rules, and selective vermilion corrections. It should feel authored and specific to a Hungarian parent's school-day questions—not like a generic SaaS landing page or a child-facing school portal. The public surfaces are open, flat compositions; hierarchy comes from scale, section boundaries, and the contrast between paper and ink.

The system changes register when the job changes. The landing's transcript is explicitly synthetic Lilla–Áron product proof; the public Google pledge wall becomes a dark civic ledger; and the backend-served credential page is a contained, utilitarian form with its own system-font and rounded-control vocabulary. These flows must remain visually and conceptually distinct because they carry different data and trust boundaries.

**Key Characteristics:**

- Cool notebook paper with cobalt structure and restrained vermilion correction marks.
- Narrow, oversized display type paired with calm body copy and operational mono labels.
- Full-width ledger compositions built from rules and asymmetrical 37/63 splits, not floating cards.
- Square printed controls with flat fill, authored line icons, and a dashed registration rule.
- Grid paper used as meaningful school material on selected surfaces, never as ambient decoration everywhere.
- One explicitly isolated credential-form exception with rounded fields and a single soft sheet shadow.

## Colors

The public-site palette behaves like ink on cool stationery; saturated color is rare and semantic, while the credential page keeps a separate neutral application palette.

### Primary

- **Cobalt Ink** (#113f7a): The principal voice for brand marks, strong copy, structural rules, links, and dark-on-light interaction.
- **Press Cobalt** (#073896): The denser action color for filled buttons, selected text, and the dashboard's connector panel.
- **Washed Cobalt** (#aebfda): The quiet rule color for divisions, table lines, and restrained underlines.

### Secondary

- **Vermilion Correction** (#d64a35): Editorial intervention only—correction loops, brackets, step numbers, Claude marks, and the global focus outline.
- **Attendance Yellow** (#f2c84b): Attention and in-progress status, plus the pale highlighted insight derived from it.
- **Register Green** (#286d58): Positive or connected state, including the transcript tool indicator.

### Neutral

- **Cool Paper** (#f4f7fb): Default public-site canvas and browser theme color.
- **Bright Paper** (#fbfcfe): Transcript sheets, grid-backed sections, field surfaces, and light text on dark ink.
- **Carbon Ink** (#0b121c): Primary reading color and the dark advocacy-wall foundation.
- **Muted Ink** (#516071): Explanatory body copy and secondary links.
- **Blue Graph Rule** (rgba(17, 63, 122, .115)): Low-opacity 28px graph-paper lines; this remains materially tied to notebook content.
- **Night Surface** (#101a27): Raised tonal band within the dark pledge wall.
- **Night Rule** (#405065): Dividers and registry columns on the pledge wall.
- **Night Copy** (#c4ceda): Readable secondary copy on dark pledge surfaces.
- **Night Meta** (#9caabe): Field help, headers, dates, and quiet dark-surface metadata.
- **Credential Canvas** (#f4f5f7): Neutral viewport ground for the backend-served form.
- **Credential Sheet** (#ffffff): The only elevated container in the shipped interface.
- **Credential Ink** (#14181f): Primary credential-form copy and control text.
- **Credential Muted** (#626b78): Credential tagline, hints, and disclaimer copy.
- **Credential Group Border** (#dde1e7): Sheet and fieldset outline.
- **Credential Field Border** (#c3cad4): Default input outline on the credential form.
- **Credential Blue** (#1a56db): Full-width credential submit action.
- **Credential Secondary** (#eef1f6): Progressive-disclosure action for adding another child.

### Named Rules

**The Ink-and-Correction Rule.** Cobalt carries structure and action; vermilion marks exceptions, annotations, sequence, and focus. Do not let the correction color become a general fill.

**The Paper Has a Job Rule.** Graph lines appear only where the interface is acting like school paper—the synthetic transcript, the advocacy statement, and the 404 ledger page.

**The Trust Registers Stay Separate Rule.** Keep the pale editorial site, dark public pledge ledger, and neutral credential sheet visually distinct; they represent separate data flows.

## Typography

**Display Font:** Big Shoulders Display Variable (with Arial Narrow fallback)

**Body Font:** Manrope Variable (with Manrope and system-ui fallbacks)

**Label Font:** IBM Plex Mono (with monospace fallback)

**Mono Font:** IBM Plex Mono (with monospace fallback)
**Credential exception:** The backend form uses system-ui with -apple-system and Segoe UI fallbacks.

**Character:** Big Shoulders gives section openings the compressed authority of a printed workbook cover. Manrope keeps parent-facing explanations direct and legible, while IBM Plex Mono makes timestamps, counters, status, and indices feel recorded rather than decorated. The OAuth credential page deliberately uses the platform stack for a familiar, low-distraction form.

### Hierarchy

- **Display** (600, fluid 4.5–9.5rem in the shipped surfaces, 0.76–0.78 line-height): Hero and section-opening phrases only; most instances are uppercase, with tight negative tracking.
- **Headline** (700, fluid 2.1–6rem, 0.98–1.05 line-height): High-stakes warnings and advocacy statements in Manrope, not the display face.
- **Lead** (650, fluid 1.35–2.35rem, 1.32–1.35 line-height): The interpretive statement paired with a large display heading.
- **Body** (400, generally .78–1.25rem, 1.5–1.75 line-height): Explanations and legal copy; reading measures usually stop between 42rem and 64rem.
- **Action** (750–800, .73–.9rem): Buttons and inline next-step links.
- **Label** (500, .58–.72rem, .04–.12em tracking): Timestamps, ruler marks, status labels, counts, and uppercase operational metadata.
- **Credential Body** (400–700, .75–1.5rem): The backend form's compact system-font hierarchy, independent of the editorial type trio.

### Named Rules

**The Narrow Voice Rule.** Big Shoulders is for decisive display phrases, never body copy, form labels, navigation, or long explanations.

**The Recorded Detail Rule.** Use IBM Plex Mono where information behaves like a timestamp, index, counter, measurement, status, or marginal note—not as a broad stylistic wash.

## Layout

Public pages use full-width, edge-connected sections with a fluid page inset. The primary desktop grammar is a 37/63 split: question or label on the left, proof or explanation on the right. The landing hero uses `minmax(360px, 37%) / minmax(0, 63%)`, tightens to 36/64 below 1050px, and becomes a vertical stack at 760px. The value, pledge, dashboard, and explanatory flows stack at 800px; the footer stacks at 760px; compact navigation applies at 600px; and the long privacy heading receives an additional 480px safeguard. The body accepts screens down to 320px, with 390px treated as the practical mobile proof point.

The page inset is fluid from 1.25rem to 4.5rem. Major bands normally use 4–9rem of vertical padding via fluid clamps. There is no applied centered max-width on the public composition: the declared 1600px maximum is not currently used. Reading copy, however, is locally constrained to roughly 28–70rem according to role.

Ledger layouts align information with thin 1px washed-cobalt rules and stronger 2px cobalt starts. The transcript's 28px grid, red margin rule, top ruler, and four-column lesson rows make it the signature spatial component. On mobile, lesson topics wrap into a third-column continuation; registry rows and three-column prompt/value bands become stacked records instead of horizontally compressed tables.

The `/authorize` route is intentionally separate: a viewport-centered sheet capped at 34rem, with 24px outer padding and 24–40px inner padding. Additional child fieldsets disclose progressively and remain in the single-column form flow.

### Named Rules

**The Split-Then-Stack Rule.** Keep major desktop flows at the 37/63 ledger proportion, then switch to a true vertical sequence between 760px and 800px instead of squeezing both registers.

## Elevation & Depth

The editorial site is flat. It uses no shadows: paper shifts, dark bands, borders, graph lines, and inset rules establish depth and grouping. The sole shipped shadow belongs to the isolated `/authorize` credential sheet, where it separates the form from a neutral browser canvas.

### Shadow Vocabulary

- **Credential Sheet Ambient** (`0 18px 46px -32px rgb(20 24 31 / 45%)`): A low, broad shadow used only by the backend-served credential container. It is not a public-site card style.

### Named Rules

**The Flat Ledger Rule.** Public-site surfaces stay edge-connected and shadowless; create hierarchy with rules, tonal bands, and spacing.

**The One Shadow Rule.** Do not add another elevation level. The credential sheet is the only shipped elevated surface.

## Shapes

The public-site form language is square, printed, and rule-bound. Buttons, tags, textareas, code wells, blockquotes, panels, and Google sign-in controls use zero radius. Thin strokes separate information; stronger 2px strokes announce actions or the beginning of a list.

Curves on the public site are semantic marks, not containers: the irregular vermilion loop circles “igazolandó,” and the rotated circular exclamation mark behaves like a teacher's annotation. The authored book mark, square-ended ArrowMark, and eight-ray SparkMark use mitered or square strokes.

The `/authorize` sheet is the explicit exception. Its outer container uses an 18px radius, field groups 12px, notices and errors 10px, and controls 8px. Those radii are local to the credential flow and must not seed generic rounded cards elsewhere.

### Named Rules

**The No Generic Card Rule.** On the public site, do not turn content into rounded, floating, shadowed cards; sections and records connect to the page grid.

**The Curve Must Mean Something Rule.** Outside `/authorize`, curves belong to human correction marks and warning symbols, not routine containers.

## Components

### Buttons

Public actions feel like small printed controls stamped in cobalt.

- **Shape:** Square corners, a 2px border, at least 3.55rem high, and compact heavy Manrope type.
- **Primary:** Press-cobalt fill with bright-paper text; the landing CTA grows to 4.8rem and up to 25vw before becoming full-width on mobile.
- **Registration Mark:** A dashed 1px left rule is inset into every shared `.button`; preserve it alongside the authored ArrowMark when the action navigates.
- **Hover / Focus / Active:** Hover shifts to Cobalt Ink, active to Carbon Ink, and focus receives a 3px vermilion outline with 4px offset. Fill changes run for 120ms with `ease`.
- **Secondary:** Transparent with Press Cobalt text and border; on dark warning panels the border and text become light blue/white.
- **Google:** The pledge wall uses a square white provider button with the official four-color inline Google mark. It authenticates the public wall only and is not a KRÉTA connection control.

### Cards / Containers

Containers feel like connected ledger sections, not detachable objects.

- **Corner Style:** Square throughout the public site.
- **Background:** Cool Paper by default, Bright Paper for worked examples, Carbon/Night Surface for high-stakes and public pledge sections.
- **Shadow Strategy:** None on public surfaces.
- **Border:** 1px Washed Cobalt for ordinary divisions; 2px Cobalt Ink for list starts, statements, and important wells.
- **Internal Padding:** Fluid page and section spacing; dense records use roughly .35–2rem.

### Inputs / Fields

- **Pledge textarea:** Square Bright Paper field, full width, 2px blue-gray border, 1rem inset, and vertical resizing.
- **Consent:** Native square checkbox with Attention Yellow accent.
- **Focus:** All public controls inherit the vermilion 3px focus outline and 4px offset.
- **Status:** Success and failure messages use pale mint and coral against the dark pledge surface; empty/loading records switch to mono metadata.
- **Credential fields:** Only `/authorize` uses 8px controls with a 1px cool-gray border, 42px minimum height, and a restrained blue focus ring.

### Navigation

The header begins with a 5px cobalt press stripe and a 1px bottom rule. The authored open-book wordmark sits inside a square 2px frame; navigation is compact, heavy Manrope in muted ink. Hover and active links turn cobalt and gain a 2px underline with generous offset. At 600px, type and gaps tighten and the last navigation action is hidden; the footer independently retains all three routes and stacks at 760px.

### Synthetic Transcript

The landing's principal proof component is a Bright Paper graph sheet with a 28px grid, top ruler, red margin rule, speaker marks, lesson ledger, and a yellow-tinted insight annotated in vermilion. Its tag must continue to state that the Lilla–Áron data is a demonstration and not real student data. Messages enter over 420ms with the custom acceleration curve; later records use 80ms, 150ms, and 220ms staging. Under reduced motion, animation and transition durations collapse to .01ms and smooth scrolling is disabled.

### Pledge Registry

The Google-authenticated public wall is a dark, two-register composition: advocacy and count on the left, identity/form controls on the right, followed by a ruled three-column public list. At 800px it becomes a vertical sequence and list headers yield to self-contained rows. It must never look like or imply a connected KRÉTA/student account.

### Credential Sheet

The backend-served form uses the local credential tokens rather than the Astro site's fonts and square geometry. It is a centered, rounded white sheet containing an explicit amber trust notice, rounded fieldsets, up to three progressively disclosed child groups, a muted secondary action, a full-width blue submit action, and a compact disclaimer. Preserve this as a contained operational exception; the warning remains above the fields.

### Authored Marks

Use BrandMark for the open-book identity, ArrowMark for directional action, and SparkMark for Claude/system responses. All are inline SVG with square or miter stroke treatment. Do not replace them with generic icon-library glyphs.

## Do's and Don'ts

### Do:

- **Do** use the 37/63 ledger split for major question-and-proof compositions, then stack it between 760px and 800px according to content density.
- **Do** keep cobalt structural, vermilion corrective, yellow attentive, and green confirmatory.
- **Do** preserve square, flat, edge-connected public-site components and the dashed registration rule on shared buttons.
- **Do** label the landing transcript as synthetic and retain only the fictional Lilla–Áron demonstration data.
- **Do** keep the public Google pledge wall and KRÉTA credential form visibly separate from each other and from the Claude connection dashboard.
- **Do** preserve keyboard focus, 390px responsiveness, and the reduced-motion override.

### Don't:

- **Don't** introduce generic rounded cards, pill controls, floating panels, gradients, or decorative drop shadows into the public site.
- **Don't** spread graph paper across every surface; reserve it for content that materially behaves like a notebook or ledger.
- **Don't** use Big Shoulders for prose or IBM Plex Mono as a general body face.
- **Don't** replace the authored book, arrow, or spark marks with library icons.
- **Don't** migrate the `/authorize` sheet's rounded application styling into landing, dashboard, explanatory, legal, pledge, or error surfaces.
- **Don't** soften, bury, or visually de-emphasize the credential warning, and never imply that Google identity is linked to a student.
