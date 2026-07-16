'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { GhostButton, HairlineRow, HudInput, SeedBadge, StaggerList } from '@/components/hud/panel-kit'

const fetcher = async (url: string) => {
  const res = await fetch(url)
  const json = await res.json()
  if (!res.ok) throw new Error(json.error ?? 'Obsidian unreachable')
  return json
}

type BrowseData = {
  connected: boolean
  dir: string
  folders: string[]
  notes: string[]
}

type SearchData = {
  connected: boolean
  results: Array<{ path: string; score: number; snippets: string[] }>
}

type NoteData = { connected: boolean; path: string; content: string }

export function NotesPanel() {
  const [dir, setDir] = useState('')
  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [openPath, setOpenPath] = useState<string | null>(null)

  const browse = useSWR<BrowseData>(
    !submitted && !openPath
      ? `/api/obsidian/notes?dir=${encodeURIComponent(dir)}`
      : null,
    fetcher,
  )
  const search = useSWR<SearchData>(
    submitted && !openPath
      ? `/api/obsidian/notes?q=${encodeURIComponent(submitted)}`
      : null,
    fetcher,
  )
  const note = useSWR<NoteData>(
    openPath ? `/api/obsidian/notes?path=${encodeURIComponent(openPath)}` : null,
    fetcher,
  )

  const disconnected =
    Boolean(browse.error) || Boolean(search.error) || Boolean(note.error)
  const loading = browse.isLoading || search.isLoading || note.isLoading

  function openFolder(folder: string) {
    setOpenPath(null)
    setSubmitted('')
    setQuery('')
    setDir(dir ? `${dir}/${folder.slice(0, -1)}` : folder.slice(0, -1))
  }

  function goUp() {
    const parts = dir.split('/')
    parts.pop()
    setDir(parts.join('/'))
  }

  const browseEntries: Array<{ kind: 'folder' | 'file'; name: string }> = browse.data
    ? [
        ...browse.data.folders.map((name) => ({ kind: 'folder' as const, name })),
        ...browse.data.notes.map((name) => ({ kind: 'file' as const, name })),
      ]
    : []

  return (
    <div className="flex h-full min-h-0 flex-col">
      <form
        className="flex items-center gap-2 p-3"
        onSubmit={(e) => {
          e.preventDefault()
          setOpenPath(null)
          setSubmitted(query.trim())
        }}
      >
        <HudInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="search vault…"
          aria-label="Search Obsidian vault"
        />
        {submitted && (
          <GhostButton
            onClick={() => {
              setSubmitted('')
              setQuery('')
            }}
          >
            clear
          </GhostButton>
        )}
      </form>

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {disconnected && (
          <div className="flex justify-end">
            <SeedBadge>obsidian disconnected</SeedBadge>
          </div>
        )}
        {disconnected && (
          <p className="font-mono text-xs leading-relaxed text-muted-foreground">
            {'> vault unreachable.'}
            <br />
            {'> start Obsidian with the Local REST API plugin (HTTP :27123)'}
            <br />
            {'> and add its key in settings.'}
          </p>
        )}
        {loading && (
          <p className="animate-pulse font-mono text-xs text-muted-foreground">
            reading vault…
          </p>
        )}

        {/* Note reader */}
        {openPath && note.data && (
          <article>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="truncate font-mono text-[10px] uppercase tracking-widest text-accent">
                {openPath}
              </h3>
              <GhostButton className="shrink-0" onClick={() => setOpenPath(null)}>
                back
              </GhostButton>
            </div>
            <pre className="whitespace-pre-wrap rounded-md border-b border-[oklch(1_0_0_/_6%)] bg-[oklch(1_0_0_/_2%)] p-3 font-mono text-xs leading-relaxed text-foreground">
              {note.data.content}
            </pre>
          </article>
        )}

        {/* Search results */}
        {!openPath && submitted && search.data && (
          <>
            {search.data.results.length === 0 && (
              <p className="font-mono text-xs text-muted-foreground">
                {'> no matches.'}
              </p>
            )}
            <StaggerList
              items={search.data.results}
              keyFn={(result) => result.path}
              renderItem={(result) => (
                <HairlineRow as="button" interactive onClick={() => setOpenPath(result.path)}>
                  <span className="font-mono text-[10px] uppercase tracking-widest text-accent">
                    {result.path}
                  </span>
                  {result.snippets[0] && (
                    <p className="mt-1 line-clamp-2 text-pretty text-xs text-muted-foreground">
                      {result.snippets[0]}
                    </p>
                  )}
                </HairlineRow>
              )}
            />
          </>
        )}

        {/* Vault browser */}
        {!openPath && !submitted && browse.data && (
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                /{dir}
              </span>
              {dir && (
                <GhostButton className="shrink-0" onClick={goUp}>
                  up
                </GhostButton>
              )}
            </div>
            {browseEntries.length === 0 ? (
              <p className="font-mono text-xs text-muted-foreground">
                {'> empty folder.'}
              </p>
            ) : (
              <StaggerList
                items={browseEntries}
                keyFn={(entry) => `${entry.kind}-${entry.name}`}
                renderItem={(entry) =>
                  entry.kind === 'folder' ? (
                    <button
                      type="button"
                      onClick={() => openFolder(entry.name)}
                      className="w-full rounded-sm px-2 py-1 text-left font-mono text-xs text-accent transition-colors hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {entry.name}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setOpenPath(dir ? `${dir}/${entry.name}` : entry.name)}
                      className="w-full rounded-sm px-2 py-1 text-left font-mono text-xs text-foreground transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {entry.name}
                    </button>
                  )
                }
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
