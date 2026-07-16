import { getRawDb } from "@/lib/db"

/**
 * Tasks/reminders CRUD (Phase 6D). Raw-SQL style, mirroring lib/events.ts.
 * Recurrence recomputation happens in completeTask; the scheduler (separate
 * module) is responsible for firing reminders and setting lastFiredAt.
 */

export type TaskRecurrence = "daily" | "weekdays" | "weekly" | "monthly"

export interface TaskInput {
  title: string
  notes?: string
  dueAt?: number
  remindAt?: number
  recurrence?: TaskRecurrence
}

export interface Task {
  id: number
  title: string
  notes: string | null
  status: "open" | "done"
  dueAt: number | null
  remindAt: number | null
  recurrence: TaskRecurrence | null
  lastFiredAt: number | null
  createdAt: number
  updatedAt: number
  completedAt: number | null
}

type TaskRow = {
  id: number
  title: string
  notes: string | null
  status: string
  due_at: number | null
  remind_at: number | null
  recurrence: string | null
  last_fired_at: number | null
  created_at: number
  updated_at: number
  completed_at: number | null
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    status: row.status as Task["status"],
    dueAt: row.due_at,
    remindAt: row.remind_at,
    recurrence: (row.recurrence as TaskRecurrence | null) ?? null,
    lastFiredAt: row.last_fired_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  }
}

function requireTask(id: number): TaskRow {
  const db = getRawDb()
  const row = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as TaskRow | undefined
  if (!row) throw new Error(`Task ${id} not found`)
  return row
}

export function createTask(input: TaskInput): Task {
  const db = getRawDb()
  const now = Date.now()
  const result = db
    .prepare(
      `INSERT INTO tasks (title, notes, status, due_at, remind_at, recurrence, created_at, updated_at)
       VALUES (?, ?, 'open', ?, ?, ?, ?, ?)`,
    )
    .run(
      input.title,
      input.notes ?? null,
      input.dueAt ?? null,
      input.remindAt ?? null,
      input.recurrence ?? null,
      now,
      now,
    )
  return rowToTask(requireTask(Number(result.lastInsertRowid)))
}

export function listTasks(opts?: { status?: "open" | "done"; dueBefore?: number }): Task[] {
  const db = getRawDb()
  const clauses: string[] = []
  const params: unknown[] = []
  if (opts?.status) {
    clauses.push("status = ?")
    params.push(opts.status)
  }
  if (opts?.dueBefore !== undefined) {
    clauses.push("due_at IS NOT NULL AND due_at <= ?")
    params.push(opts.dueBefore)
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""
  const rows = db
    .prepare(`SELECT * FROM tasks ${where} ORDER BY COALESCE(due_at, remind_at, created_at) ASC`)
    .all(...params) as TaskRow[]
  return rows.map(rowToTask)
}

function addDays(ms: number, days: number): number {
  return ms + days * 24 * 60 * 60 * 1000
}

function addMonths(ms: number, months: number): number {
  const d = new Date(ms)
  d.setMonth(d.getMonth() + months)
  return d.getTime()
}

/** Compute the next occurrence timestamp for a given recurrence rule. */
function nextOccurrence(ms: number, recurrence: TaskRecurrence): number {
  switch (recurrence) {
    case "daily":
      return addDays(ms, 1)
    case "weekly":
      return addDays(ms, 7)
    case "monthly":
      return addMonths(ms, 1)
    case "weekdays": {
      let next = addDays(ms, 1)
      const day = new Date(next).getDay() // 0 = Sunday, 6 = Saturday
      if (day === 6) next = addDays(next, 2)
      else if (day === 0) next = addDays(next, 1)
      return next
    }
  }
}

export function completeTask(id: number): Task {
  const db = getRawDb()
  const row = requireTask(id)
  const now = Date.now()

  db.prepare(`UPDATE tasks SET status = 'done', completed_at = ?, updated_at = ? WHERE id = ?`).run(
    now,
    now,
    id,
  )

  if (row.recurrence) {
    const recurrence = row.recurrence as TaskRecurrence
    const nextDueAt = row.due_at ? nextOccurrence(row.due_at, recurrence) : null
    const nextRemindAt = row.remind_at ? nextOccurrence(row.remind_at, recurrence) : null
    db.prepare(
      `INSERT INTO tasks (title, notes, status, due_at, remind_at, recurrence, created_at, updated_at)
       VALUES (?, ?, 'open', ?, ?, ?, ?, ?)`,
    ).run(row.title, row.notes, nextDueAt, nextRemindAt, row.recurrence, now, now)
  }

  return rowToTask(requireTask(id))
}

export function snoozeTask(id: number, minutes: number): Task {
  requireTask(id)
  const db = getRawDb()
  const now = Date.now()
  const newRemindAt = now + minutes * 60 * 1000
  db.prepare(
    `UPDATE tasks SET remind_at = ?, last_fired_at = NULL, updated_at = ? WHERE id = ?`,
  ).run(newRemindAt, now, id)
  return rowToTask(requireTask(id))
}

export function updateTask(id: number, patch: Partial<TaskInput>): Task {
  requireTask(id)
  const db = getRawDb()
  const now = Date.now()

  const fields: string[] = []
  const params: unknown[] = []
  if (patch.title !== undefined) {
    fields.push("title = ?")
    params.push(patch.title)
  }
  if (patch.notes !== undefined) {
    fields.push("notes = ?")
    params.push(patch.notes)
  }
  if (patch.dueAt !== undefined) {
    fields.push("due_at = ?")
    params.push(patch.dueAt)
  }
  if (patch.remindAt !== undefined) {
    fields.push("remind_at = ?")
    params.push(patch.remindAt)
  }
  if (patch.recurrence !== undefined) {
    fields.push("recurrence = ?")
    params.push(patch.recurrence)
  }
  fields.push("updated_at = ?")
  params.push(now)
  params.push(id)

  db.prepare(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`).run(...params)
  return rowToTask(requireTask(id))
}

export function deleteTask(id: number): void {
  requireTask(id)
  const db = getRawDb()
  db.prepare(`DELETE FROM tasks WHERE id = ?`).run(id)
}
