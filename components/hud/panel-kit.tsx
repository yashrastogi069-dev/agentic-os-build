'use client'

import { cn } from '@/lib/utils'

/**
 * Panel kit — Phase 4B (`tasks/MASTER_PLAN_V2.md` §3). Reusable chrome
 * primitives extracted from the real, already-shipped recipes duplicated
 * across `feed-panel.tsx` / `memory-panel.tsx` / `notes-panel.tsx` /
 * `skills-panel.tsx` / `settings-panel.tsx` (Phase 3's "Chunk B visual
 * redesign"), not new inventions. Chunk 4C moves those five panels onto
 * these primitives; interaction logic, SWR wiring, and honest fallbacks are
 * untouched — this file is chrome only.
 *
 * Every primitive merges its own recipe with a caller-supplied `className`
 * via `cn()` (clsx + tailwind-merge), not plain string concatenation — so a
 * conflicting override (e.g. skills-panel's accent-colored "discover"
 * button) reliably wins instead of depending on Tailwind's generated
 * stylesheet order.
 */

const STAGGER_STEP_MS = 40
const STAGGER_CAP = 8

/**
 * Section eyebrow label — the
 * `font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground`
 * recipe used at the top of every panel (feed's "unified events", skills'
 * "skill factory · loop engine", each settings `<h3>`). `as` picks the tag;
 * settings uses `h3` for its section headers, the single-heading panels use
 * the default `span`.
 */
export function PanelSectionHeading({
  as: Tag = 'span',
  className = '',
  children,
}: {
  as?: 'span' | 'h3'
  className?: string
  children: React.ReactNode
}) {
  return (
    <Tag className={cn('font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground', className)}>
      {children}
    </Tag>
  )
}

/**
 * Borderless row + bottom hairline separator — feed-panel's exact list-row
 * recipe (`border-b border-[oklch(1_0_0_/_6%)] ... last:border-b-0
 * hover:bg-[oklch(1_0_0_/_4%)]`), generalized into the shared replacement for
 * the `border border-border bg-card` boxed-card look duplicated in
 * memory/notes/skills. Polymorphic (`as`) so it can render as a `li` (list
 * rows), `div` (static rows), or `button` (clickable rows — notes search
 * results, skill list items); `interactive` adds full-width text-left +
 * focus-visible ring for the button case.
 */
export function HairlineRow({
  as = 'div',
  interactive = false,
  className = '',
  children,
  ...rest
}: {
  as?: 'div' | 'li' | 'button'
  interactive?: boolean
  className?: string
  children: React.ReactNode
} & React.HTMLAttributes<HTMLElement>) {
  const Tag = as
  return (
    <Tag
      type={
        as === 'button'
          ? ((rest as { type?: 'button' | 'submit' | 'reset' }).type ?? 'button')
          : undefined
      }
      className={cn(
        'rounded-md border-b border-[oklch(1_0_0_/_6%)] px-3 py-2 transition-colors last:border-b-0 hover:bg-[oklch(1_0_0_/_4%)]',
        interactive && 'w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  )
}

type PanelButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: 'xs' | 'sm'
}

/**
 * Ghost button — the bordered, muted-foreground recipe used for every
 * secondary action across the panels (sync, recall, clear, back, up,
 * discover, close). `size="xs"` matches the compact `px-2 py-1 text-[10px]`
 * usage (most common); `size="sm"` matches the `px-3 py-1.5 text-xs` usage
 * (settings' bigger CTAs). Focus-visible ring added — most call sites lacked
 * one.
 */
export function GhostButton({ size = 'xs', className = '', type = 'button', ...rest }: PanelButtonProps) {
  const sizing = size === 'xs' ? 'px-2 py-1 text-[10px]' : 'px-3 py-1.5 text-xs'
  return (
    <button
      type={type}
      className={cn(
        'rounded-sm border border-border font-mono uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40',
        sizing,
        className,
      )}
      {...rest}
    />
  )
}

/**
 * Accent button — the primary/10-filled recipe used for the panels' main
 * calls to action (save, index vault, sync feeds now, copy setup command).
 */
export function AccentButton({ size = 'sm', className = '', type = 'button', ...rest }: PanelButtonProps) {
  const sizing = size === 'xs' ? 'px-2 py-1 text-[10px]' : 'px-3 py-1.5 text-xs'
  return (
    <button
      type={type}
      className={cn(
        'rounded-sm border border-primary/40 bg-primary/10 font-mono uppercase tracking-widest text-primary transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40',
        sizing,
        className,
      )}
      {...rest}
    />
  )
}

/**
 * Input capsule with focus glow — chat-panel's exact wrapper recipe
 * (`shadow-[inset...] focus-within:shadow-[inset...,0_0_16px...]`), reused
 * for panel search/filter/settings inputs so every text field in the HUD
 * shares one glow language instead of the plain bordered inputs the panels
 * used before.
 */
export function HudInput({
  className = '',
  wrapperClassName = '',
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { wrapperClassName?: string }) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-[oklch(0.1_0.02_250_/_55%)] px-3 py-1.5 shadow-[inset_0_0_0_1px_oklch(1_0_0_/_7%)] transition-shadow focus-within:shadow-[inset_0_0_0_1px_oklch(from_var(--accent-live)_l_c_h_/_45%),0_0_16px_oklch(from_var(--accent-live)_l_c_h_/_12%)]',
        wrapperClassName,
      )}
    >
      <input
        className={cn(
          'min-w-0 flex-1 bg-transparent font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground',
          className,
        )}
        {...rest}
      />
    </div>
  )
}

/**
 * Disconnected/seed-data badge — the exact destructive badge markup
 * duplicated verbatim in feed/memory-panel ("disconnected · seed data").
 * `children` overrides the label text only (notes-panel's honest fallback
 * reads "obsidian disconnected", a different but equally exact wording); the
 * visual recipe itself never changes.
 */
export function SeedBadge({ children = 'disconnected · seed data' }: { children?: React.ReactNode }) {
  return (
    <span className="rounded-sm border border-destructive/40 bg-destructive/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-destructive">
      {children}
    </span>
  )
}

/**
 * Staggered list wrapper — applies the `enter-rise` entrance (globals.css)
 * to each item with a 40ms stagger, capped at the 8th item so long lists
 * (skill run history, feed backlog) don't queue an ever-growing delay.
 * Reduced-motion is a pure CSS no-op via `enter-rise`'s override in the
 * existing `@media (prefers-reduced-motion: reduce)` block — no JS branch
 * needed, matching how every other `enter-*` utility in this codebase works.
 */
export function StaggerList<T>({
  items,
  renderItem,
  keyFn,
  as: Tag = 'ul',
  itemAs: ItemTag = 'li',
  className = '',
  itemClassName = '',
}: {
  items: T[]
  renderItem: (item: T, index: number) => React.ReactNode
  keyFn: (item: T, index: number) => React.Key
  as?: 'ul' | 'div'
  itemAs?: 'li' | 'div'
  className?: string
  itemClassName?: string
}) {
  return (
    <Tag className={className}>
      {items.map((item, index) => (
        <ItemTag
          key={keyFn(item, index)}
          className={cn('enter-rise', itemClassName)}
          style={{ animationDelay: `${Math.min(index, STAGGER_CAP - 1) * STAGGER_STEP_MS}ms` }}
        >
          {renderItem(item, index)}
        </ItemTag>
      ))}
    </Tag>
  )
}
