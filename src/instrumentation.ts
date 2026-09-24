/**
 * Lodestar background jobs.
 *
 * The rule evaluator loop sweeps every enabled alert rule once a minute and
 * promotes breaches into real incidents (and auto-resolves cleared ones).
 * A sweep-on-read guard inside GET /api/alerts keeps the same guarantee for
 * runtimes where this hook does not boot.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  try {
    const { startEvaluatorLoop } = await import('./lib/rule-evaluator')
    startEvaluatorLoop()
  } catch {
    // never block server boot on the evaluator
  }
}
