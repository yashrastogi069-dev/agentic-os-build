import { generateText } from "ai"
import { eq, desc, sql } from "drizzle-orm"
import { getDb, schema } from "@/lib/db"
import { getChatModel } from "@/lib/agent"

/**
 * Skill Factory + Loop Engine.
 *
 * A skill = a named, versioned instruction set for a repeated task.
 * - Runs execute via the OS brain (Groq/Ollama) with the skill's instructions.
 * - Every run is logged to skill_runs; ratings feed the refine cycle.
 * - Skills export as Claude-compatible SKILL.md and deploy to GitHub repos
 *   at .claude/skills/<name>/SKILL.md via the Contents API.
 */

const { skills, skillRuns } = schema

// ---------- CRUD ----------

export function listSkills() {
  return getDb().select().from(skills).orderBy(desc(skills.updatedAt)).all()
}

export function getSkill(idOrName: number | string) {
  const db = getDb()
  return typeof idOrName === "number"
    ? db.select().from(skills).where(eq(skills.id, idOrName)).get()
    : db.select().from(skills).where(eq(skills.name, idOrName)).get()
}

export function createSkill(input: {
  name: string
  description: string
  instructions: string
  sourceTask?: string
}) {
  const slug = input.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
  return getDb()
    .insert(skills)
    .values({
      name: slug,
      description: input.description,
      instructions: input.instructions,
      sourceTask: input.sourceTask ?? "manual",
    })
    .returning()
    .get()
}

export function deleteSkill(id: number) {
  const db = getDb()
  db.delete(skillRuns).where(eq(skillRuns.skillId, id)).run()
  db.delete(skills).where(eq(skills.id, id)).run()
}

// ---------- Loop Engine: run + measure ----------

export async function runSkill(idOrName: number | string, input: string) {
  const skill = getSkill(idOrName)
  if (!skill) throw new Error(`Skill not found: ${idOrName}`)

  const { text } = await generateText({
    model: getChatModel(),
    system: `You are executing the skill "${skill.name}" (v${skill.version}): ${skill.description}\n\n${skill.instructions}\n\nFollow the skill instructions exactly. Output only the result.`,
    prompt: input,
  })

  const run = getDb()
    .insert(skillRuns)
    .values({
      skillId: skill.id,
      skillVersion: skill.version,
      input,
      output: text,
    })
    .returning()
    .get()

  return { skill, run }
}

export function rateRun(runId: number, rating: 1 | -1, feedback?: string) {
  getDb()
    .update(skillRuns)
    .set({ rating, feedback: feedback ?? null })
    .where(eq(skillRuns.id, runId))
    .run()
}

export function listRuns(skillId: number, limit = 20) {
  return getDb()
    .select()
    .from(skillRuns)
    .where(eq(skillRuns.skillId, skillId))
    .orderBy(desc(skillRuns.createdAt))
    .limit(limit)
    .all()
}

export function skillHealth(skillId: number) {
  const row = getDb()
    .select({
      total: sql<number>`count(*)`,
      up: sql<number>`sum(case when rating = 1 then 1 else 0 end)`,
      down: sql<number>`sum(case when rating = -1 then 1 else 0 end)`,
    })
    .from(skillRuns)
    .where(eq(skillRuns.skillId, skillId))
    .get()
  return { total: row?.total ?? 0, up: row?.up ?? 0, down: row?.down ?? 0 }
}

// ---------- Loop Engine: refine ----------

/**
 * Propose a revised instruction set based on negative feedback.
 * Returns the proposal — caller must approve via applyRefinement.
 */
export async function proposeRefinement(skillId: number) {
  const skill = getSkill(skillId)
  if (!skill) throw new Error(`Skill not found: ${skillId}`)

  const badRuns = getDb()
    .select()
    .from(skillRuns)
    .where(eq(skillRuns.skillId, skillId))
    .orderBy(desc(skillRuns.createdAt))
    .limit(30)
    .all()
    .filter((r) => r.rating === -1)
    .slice(0, 5)

  if (badRuns.length === 0) {
    return { skill, proposal: null, reason: "No negative-rated runs to learn from." }
  }

  const failures = badRuns
    .map(
      (r, i) =>
        `### Failure ${i + 1}\nInput: ${r.input.slice(0, 500)}\nOutput: ${r.output.slice(0, 500)}\nUser feedback: ${r.feedback ?? "(thumbs down, no comment)"}`,
    )
    .join("\n\n")

  const { text } = await generateText({
    model: getChatModel(),
    system:
      "You improve skill instructions for an AI agent. Given the current instructions and failed runs with user feedback, output ONLY the complete revised instructions — no preamble, no explanation.",
    prompt: `## Current instructions (v${skill.version}) for skill "${skill.name}"\n${skill.instructions}\n\n## Failed runs\n${failures}\n\nRewrite the instructions to fix these failures while keeping what works.`,
  })

  return { skill, proposal: text.trim(), reason: `Based on ${badRuns.length} negative run(s).` }
}

export function applyRefinement(skillId: number, newInstructions: string) {
  const skill = getSkill(skillId)
  if (!skill) throw new Error(`Skill not found: ${skillId}`)
  return getDb()
    .update(skills)
    .set({
      instructions: newInstructions,
      version: skill.version + 1,
      status: "built",
      updatedAt: new Date(),
    })
    .where(eq(skills.id, skillId))
    .returning()
    .get()
}

// ---------- SKILL.md export + GitHub deploy ----------

export function toSkillMd(skill: schema.Skill): string {
  return `---
name: ${skill.name}
description: ${skill.description.replace(/\n/g, " ")}
---

# ${skill.name}

${skill.description}

## Instructions

${skill.instructions}

<!-- Generated by Agentic OS Skill Factory · v${skill.version} -->
`
}

/**
 * Deploy a skill to a GitHub repo as .claude/skills/<name>/SKILL.md
 * via the Contents API (create or update). Requires GITHUB_TOKEN.
 */
export async function deploySkillToGithub(skillId: number, repo: string, basePath = ".claude/skills") {
  const token = process.env.GITHUB_TOKEN
  if (!token) throw new Error("GITHUB_TOKEN not set — add it to .env.local first.")
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`Invalid repo (expected owner/name): ${repo}`)

  const skill = getSkill(skillId)
  if (!skill) throw new Error(`Skill not found: ${skillId}`)

  const filePath = `${basePath.replace(/^\/+|\/+$/g, "")}/${skill.name}/SKILL.md`
  const apiUrl = `https://api.github.com/repos/${repo}/contents/${filePath}`
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  }

  // Existing file? Need its SHA to update.
  let existingSha: string | undefined
  const probe = await fetch(apiUrl, { headers })
  if (probe.ok) {
    const json = (await probe.json()) as { sha?: string }
    existingSha = json.sha
  }

  const res = await fetch(apiUrl, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `chore(skills): deploy ${skill.name} v${skill.version} from Agentic OS`,
      content: Buffer.from(toSkillMd(skill), "utf8").toString("base64"),
      ...(existingSha ? { sha: existingSha } : {}),
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`GitHub deploy failed (${res.status}): ${body.slice(0, 300)}`)
  }
  const result = (await res.json()) as { commit?: { sha?: string; html_url?: string } }

  const deployedTo = `${repo}@${filePath}`
  getDb()
    .update(skills)
    .set({ status: "deployed", deployedTo, updatedAt: new Date() })
    .where(eq(skills.id, skillId))
    .run()

  return { deployedTo, commitSha: result.commit?.sha, commitUrl: result.commit?.html_url }
}
