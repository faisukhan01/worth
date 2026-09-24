/**
 * Lodestar background jobs.
 *
 *  - rule evaluator loop: sweeps every enabled alert rule once a minute and
 *    promotes breaches into real incidents (auto-resolving cleared ones).
 *  - report drift loop: snapshots every catalogued service's 7-day SLA via
 *    the reporting plane every three minutes and registers drift incidents.
 *
 * A sweep-on-read guard inside GET /api/alerts (and a nudge inside
 * GET /api/reports/snapshots) keeps the same guarantees for runtimes where
 * this hook does not boot.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  try {
    const { startEvaluatorLoop } = await import('./lib/rule-evaluator')
    startEvaluatorLoop()
  } catch {
    // never block server boot on the evaluator
  }
  try {
    const { startDriftLoop } = await import('./lib/report-drift')
    startDriftLoop()
  } catch {
    // never block server boot on the drift watch
  }
}
