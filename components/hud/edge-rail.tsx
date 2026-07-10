'use client'

import { Activity, Database, Settings2, StickyNote, Zap, type LucideIcon } from 'lucide-react'

export type RightTab = 'feed' | 'notes' | 'memory' | 'skills' | 'settings'

export const RAIL_ITEMS: Array<{
  tab: RightTab
  label: string
  icon: LucideIcon
  hotkey: string
}> = [
  { tab: 'feed', label: 'Feed', icon: Activity, hotkey: 'Alt+1' },
  { tab: 'notes', label: 'Notes', icon: StickyNote, hotkey: 'Alt+2' },
  { tab: 'memory', label: 'Memory', icon: Database, hotkey: 'Alt+3' },
  { tab: 'skills', label: 'Skills', icon: Zap, hotkey: 'Alt+4' },
  { tab: 'settings', label: 'Settings', icon: Settings2, hotkey: 'Alt+5' },
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
      {RAIL_ITEMS.map(({ tab, label, icon: Icon, hotkey }) => {
        const isActive = activeTab === tab
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
              isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
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
            <Icon className="size-[18px]" aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}
