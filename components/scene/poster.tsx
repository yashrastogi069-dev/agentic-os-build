/**
 * Pure-CSS reactor emblem — Phase 3 §1.3 fallback. Rendered when:
 *  - the viewport is <1024px (`variant="mobile"`, 20% opacity, sits behind
 *    the single-column mobile layout), or
 *  - WebGL is unavailable, or the desktop stage hasn't decided yet
 *    (`variant="fallback"`, full opacity, its own presentation is inherently
 *    dim/subtle so it reads correctly as the primary background).
 *
 * No `three`/`@react-three/fiber` import — safe to render during SSR and as
 * a Suspense fallback for the lazy-loaded `JarvisStage`.
 */
export function Poster({ variant }: { variant: 'mobile' | 'fallback' }) {
  return (
    <div
      className={`absolute inset-0 flex items-center justify-center overflow-hidden bg-background ${
        variant === 'mobile' ? 'opacity-20' : 'opacity-100'
      }`}
      aria-hidden="true"
    >
      <div className="hud-vignette absolute inset-0" />
      <div className="relative aspect-square w-[min(64vw,64vh)]">
        {/* Outer ring — fine ticks */}
        <div
          className="absolute inset-0 rounded-full opacity-70"
          style={{
            background:
              'repeating-conic-gradient(var(--accent-live) 0deg 0.7deg, transparent 0.7deg 6deg)',
            WebkitMask: 'radial-gradient(circle, transparent 92%, black 94%, black 97%, transparent 99%)',
            mask: 'radial-gradient(circle, transparent 92%, black 94%, black 97%, transparent 99%)',
          }}
        />
        {/* Mid ring — coarser ticks, counter-rotated feel via offset */}
        <div
          className="absolute inset-[14%] rounded-full opacity-55"
          style={{
            background: 'repeating-conic-gradient(var(--accent-live) 0deg 2deg, transparent 2deg 18deg)',
            WebkitMask: 'radial-gradient(circle, transparent 78%, black 81%, black 88%, transparent 92%)',
            mask: 'radial-gradient(circle, transparent 78%, black 81%, black 88%, transparent 92%)',
          }}
        />
        {/* Inner coil ring — solid thin band */}
        <div
          className="absolute inset-[30%] rounded-full opacity-80"
          style={{
            background: 'var(--accent-live)',
            WebkitMask: 'radial-gradient(circle, transparent 66%, black 70%, black 82%, transparent 86%)',
            mask: 'radial-gradient(circle, transparent 66%, black 70%, black 82%, transparent 86%)',
          }}
        />
        {/* Core */}
        <div
          className="animate-core-pulse absolute inset-[42%] rounded-full"
          style={{
            background: 'var(--accent-live)',
            boxShadow: '0 0 min(6vw, 6vh) var(--accent-live), 0 0 min(1.5vw, 1.5vh) var(--accent-live)',
          }}
        />
      </div>
    </div>
  )
}
