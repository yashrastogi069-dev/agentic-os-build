'use client'

import { useState } from 'react'
import { StatusBar } from '@/components/status-bar'
import { CoreStage, type CoreState } from '@/components/core-stage'
import { ChatPanel } from '@/components/chat-panel'
import { FeedPanel } from '@/components/feed-panel'
import { MemoryPanel } from '@/components/memory-panel'
import { NotesPanel } from '@/components/notes-panel'
import { SkillsPanel } from '@/components/skills-panel'
import { SettingsPanel } from '@/components/settings-panel'

type RightTab = 'feed' | 'notes' | 'memory' | 'skills' | 'settings'

export default function Home() {
  const [coreState, setCoreState] = useState<CoreState>('idle')
  const [rightTab, setRightTab] = useState<RightTab>('feed')

  return (
    <main className="flex h-dvh flex-col bg-background text-foreground">
      <StatusBar onOpenSettings={() => setRightTab('settings')} />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-px bg-border lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)_minmax(0,4fr)]">
        {/* Core stage — hidden on small screens to prioritize function */}
        <section
          aria-label="Core status"
          className="hidden bg-background lg:block"
        >
          <CoreStage state={coreState} />
        </section>

        {/* Agent chat */}
        <section
          aria-label="Agent chat"
          className="flex min-h-0 flex-col bg-background"
        >
          <header className="border-b border-border px-3 py-2">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
              agent // chat
            </h2>
          </header>
          <ChatPanel onStateChange={setCoreState} />
        </section>

        {/* Right column: feed / memory / settings */}
        <section
          aria-label="Panels"
          className="flex min-h-0 flex-col bg-background"
        >
          <header className="flex border-b border-border">
            {(
              [
                ['feed', 'feed'],
                ['notes', 'notes'],
                ['memory', 'memory'],
                ['skills', 'skills'],
                ['settings', 'settings'],
              ] as Array<[RightTab, string]>
            ).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                onClick={() => setRightTab(tab)}
                aria-pressed={rightTab === tab}
                className={`flex-1 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.3em] transition-colors ${
                  rightTab === tab
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </header>
          <div className="min-h-0 flex-1">
            {rightTab === 'feed' && <FeedPanel />}
            {rightTab === 'notes' && <NotesPanel />}
            {rightTab === 'memory' && <MemoryPanel />}
            {rightTab === 'skills' && <SkillsPanel />}
            {rightTab === 'settings' && <SettingsPanel />}
          </div>
        </section>
      </div>
    </main>
  )
}
