'use client'

import {
  CheckSquare,
  Database,
  GearSix,
  Lightning,
  Note,
  Pulse,
  type Icon as PhosphorIcon,
} from '@phosphor-icons/react'

export type RightTab = 'feed' | 'notes' | 'memory' | 'skills' | 'settings' | 'tasks'

/**
 * Order here IS the hotkey order (hud-shell.tsx's Alt+1..N handler indexes
 * into this array) — hotkey labels below are derived from index, not
 * hardcoded, so appending a 6th item needs no hotkey bookkeeping.
 *
 * To add a panel, touch exactly these 4 spots:
 *   1. `RightTab` union above (add the tab id)
 *   2. `RAIL_ITEMS` below (one entry — hotkey is automatic)
 *   3. `PANEL_LABEL` in hud-shell.tsx
 *   4. the `renderPanel` switch case in hud-shell.tsx
 */
export const RAIL_ITEMS: Array<{
  tab: RightTab
  label: string
  icon: PhosphorIcon
}> = [
  { tab: 'feed', label: 'Feed', icon: Pulse },
  { tab: 'notes', label: 'Notes', icon: Note },
  { tab: 'memory', label: 'Memory', icon: Database },
  { tab: 'skills', label: 'Skills', icon: Lightning },
  { tab: 'tasks', label: 'Tasks', icon: CheckSquare },
  { tab: 'settings', label: 'Settings', icon: GearSix },
]

/**
 * Five-icon rail — Phase 3 §1.2/§6. Used both as the desktop vertical rail
 * (right edge, 48px wide) and, via `orientation="horizontal"`, the <1024px
 * bottom tab bar (§1.3) — same icons, same hotkeys, same active-panel model,
 * different chrome.
 */
export function EdgeRail({
  orientation,
  activeTab,
  onSelect,
  registerButtonRef,
  containerRef,
}: {
  orientation: 'vertical' | 'horizontal'
  activeTab: RightTab | null
  onSelect: (tab: RightTab) => void
  registerButtonRef: (tab: RightTab, el: HTMLButtonElement | null) => void
  containerRef?: React.RefObject<HTMLDivElement | null>
}) {
  const vertical = orientation === 'vertical'

  return (
    <div
      ref={containerRef}
      className={
        vertical
          ? 'hud-glass pointer-events-auto absolute right-3 top-1/2 z-30 flex w-12 -translate-y-1/2 flex-col items-center gap-1 rounded-[var(--radius-xl)] py-3'
          : 'hud-glass pointer-events-auto fixed inset-x-0 bottom-0 z-30 flex items-center justify-around px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]'
      }
      role="toolbar"
      aria-label="Panels"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
    >
      {RAIL_ITEMS.map(({ tab, label, icon: Icon }, index) => {
        const isActive = activeTab === tab
        const hotkey = `Alt+${index + 1}`
        return (
          <button
            key={tab}
            ref={(el) => registerButtonRef(tab, el)}
            type="button"
            onClick={() => onSelect(tab)}
            aria-label={`${label} (${hotkey})`}
            aria-pressed={isActive}
            title={vertical ? `${label} · ${hotkey}` : label}
            className={`relative flex size-10 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              isActive
                ? 'bg-[oklch(from_var(--accent-live)_l_c_h_/_12%)] text-primary'
                : 'text-muted-foreground hover:bg-[oklch(from_var(--accent-live)_l_c_h_/_8%)] hover:text-foreground'
            }`}
          >
            {isActive && (
              <span
                aria-hidden="true"
                className={
                  vertical
                    ? 'absolute left-0 top-1/2 h-5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full'
                    : 'absolute bottom-0 left-1/2 h-0.5 w-5 -translate-x-1/2 rounded-full'
                }
                style={{ background: 'var(--accent-live)' }}
              />
            )}
            <Icon
              className="size-[18px]"
              weight={isActive ? 'duotone' : 'regular'}
              aria-hidden="true"
            />
          </button>
        )
      })}
    </div>
  )
}
