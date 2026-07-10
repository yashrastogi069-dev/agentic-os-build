// Verify WCAG contrast ratios for the JARVIS Arc Reactor OKLCH token set.
// Rigorous: OKLCH -> linear sRGB -> WCAG relative luminance -> contrast.
// Run: node scripts/verify-contrast.mjs
// Keep the token values here in sync with app/globals.css :root,.dark.

function oklabToRgbLin(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3,
    m = m_ ** 3,
    s = s_ ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

function relLum(L, C, H) {
  const a = C * Math.cos((H * Math.PI) / 180)
  const b = C * Math.sin((H * Math.PI) / 180)
  const [r, g, bl] = oklabToRgbLin(L, a, b)
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl
}

function contrast(l1, l2) {
  const a = Math.max(l1, l2),
    b = Math.min(l1, l2)
  return (a + 0.05) / (b + 0.05)
}

const t = {
  background: [0.145, 0.008, 235],
  foreground: [0.955, 0.006, 220],
  card: [0.185, 0.01, 235],
  cardForeground: [0.955, 0.006, 220],
  popover: [0.175, 0.01, 235],
  primary: [0.84, 0.136, 213],
  primaryForeground: [0.16, 0.02, 235],
  mutedForeground: [0.685, 0.013, 220],
  muted: [0.225, 0.01, 235],
  secondary: [0.245, 0.012, 235],
  accent: [0.813, 0.165, 75],
  accentForeground: [0.18, 0.03, 70],
  destructive: [0.62, 0.19, 25],
}

const L = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, relLum(...v)]))
const pairs = [
  ['foreground', 'background', 4.5],
  ['cardForeground', 'card', 4.5],
  ['mutedForeground', 'card', 4.5],
  ['mutedForeground', 'background', 4.5],
  ['primary', 'background', 3],
  ['primaryForeground', 'primary', 4.5],
  ['accentForeground', 'accent', 4.5],
  ['destructive', 'background', 3],
]

let failed = 0
for (const [fg, bg, min] of pairs) {
  const ratio = contrast(L[fg], L[bg])
  const ok = ratio >= min
  if (!ok) failed++
  console.log(
    `${(fg + ' / ' + bg).padEnd(32)} ${ratio.toFixed(2)}:1  (min ${min})  ${ok ? 'PASS' : 'FAIL'}`,
  )
}
process.exit(failed ? 1 : 0)
