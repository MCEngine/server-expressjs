import { Router } from 'express';

/**
 * A dependency this service needs before it can serve traffic.
 *
 * Readiness takes these as an argument rather than importing them so the route
 * can be tested against a probe that fails, which is the case that matters and
 * the one a real database makes hard to arrange.
 */
export interface ReadinessProbe {
  readonly name: string;
  check(): Promise<void>;
}

export function createHealthRouter(probes: readonly ReadinessProbe[] = []): Router {
  const router = Router();

  /**
   * Liveness. Deliberately checks nothing: an orchestrator restarts a process
   * that fails this, and restarting does not fix an unreachable database — it
   * turns a degraded service into a crash loop.
   */
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  /**
   * Readiness. Checks every dependency, so a database blip takes this instance
   * out of rotation without anything killing it.
   */
  router.get('/health/ready', async (_req, res) => {
    const results = await Promise.all(
      probes.map(async (probe) => {
        try {
          await probe.check();
          return { name: probe.name, ok: true as const };
        } catch (error) {
          return {
            name: probe.name,
            ok: false as const,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );

    const ready = results.every((r) => r.ok);
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', checks: results });
  });

  return router;
}
