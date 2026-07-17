/**
 * Next.js server-startup hook (stable since v15, file-convention docs at
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md).
 * `register()` runs once when the server instance boots — this is where the
 * reminder scheduler (lib/scheduler.ts) is started so it's always running
 * while the app is up, without any page needing to import it.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./lib/scheduler")
    startScheduler()
  }
}
