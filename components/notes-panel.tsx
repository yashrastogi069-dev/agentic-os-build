'use client'

import { useState } from 'react'
import useSWR from 'swr'

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <form
        className="flex items-center gap-2 border-b border-border p-3"
        onSubmit={(e) => {
          e.preventDefault()
          setOpenPath(null)
          setSubmitted(query.trim())
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="search vault…"
          aria-label="Search Obsidian vault"
          className="min-w-0 flex-1 rounded-sm border border-border bg-secondary px-2 py-1 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none"
        />
        {submitted && (
          <button
            type="button"
            onClick={() => {
              setSubmitted('')
              setQuery('')
            }}
            className="rounded-sm border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
          >
            clear
          </button>
        )}
      </form>

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {disconnected && (
          <div className="flex justify-end">
            <span className="rounded-sm border border-destructive/40 bg-destructive/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-destructive">
              obsidian disconnected
            </span>
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
              <button
                type="button"
                onClick={() => setOpenPath(null)}
                className="shrink-0 rounded-sm border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
              >
                back
              </button>
            </div>
            <pre className="whitespace-pre-wrap rounded-sm border border-border bg-card p-3 font-mono text-xs leading-relaxed text-foreground">
              {note.data.content}
            </pre>
          </article>
        )}

        {/* Search results */}
        {!openPath && submitted && search.data && (
          <ul className="space-y-2">
            {search.data.results.length === 0 && (
              <p className="font-mono text-xs text-muted-foreground">
                {'> no matches.'}
              </p>
            )}
            {search.data.results.map((result) => (
              <li key={result.path}>
                <button
                  type="button"
                  onClick={() => setOpenPath(result.path)}
                  className="w-full rounded-sm border border-border bg-card px-3 py-2 text-left transition-colors hover:border-primary/40"
                >
                  <span className="font-mono text-[10px] uppercase tracking-widest text-accent">
                    {result.path}
                  </span>
                  {result.snippets[0] && (
                    <p className="mt-1 line-clamp-2 text-pretty text-xs text-muted-foreground">
                      {result.snippets[0]}
                    </p>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Vault browser */}
        {!openPath && !submitted && browse.data && (
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                /{dir}
              </span>
              {dir && (
                <button
                  type="button"
                  onClick={goUp}
                  className="shrink-0 rounded-sm border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                >
                  up
                </button>
              )}
            </div>
            <ul className="space-y-1">
              {browse.data.folders.map((folder) => (
                <li key={folder}>
                  <button
                    type="button"
                    onClick={() => openFolder(folder)}
                    className="w-full rounded-sm px-2 py-1 text-left font-mono text-xs text-accent transition-colors hover:bg-accent/10"
                  >
                    {folder}
                  </button>
                </li>
              ))}
              {browse.data.notes.map((file) => (
                <li key={file}>
                  <button
                    type="button"
                    onClick={() => setOpenPath(dir ? `${dir}/${file}` : file)}
                    className="w-full rounded-sm px-2 py-1 text-left font-mono text-xs text-foreground transition-colors hover:bg-primary/10"
                  >
                    {file}
                  </button>
                </li>
              ))}
              {browse.data.folders.length === 0 &&
                browse.data.notes.length === 0 && (
                  <p className="font-mono text-xs text-muted-foreground">
                    {'> empty folder.'}
                  </p>
                )}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
