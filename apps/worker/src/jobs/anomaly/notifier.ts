import type { Alert, AnomalyNotifier } from "./types";

/** Default notifier: logs the alert. Production replaces this with a
 *  PG-insert + SSE-publish implementation wired to contract 07. */
export class LoggingAnomalyNotifier implements AnomalyNotifier {
  private readonly sink: (line: string) => void;
  constructor(
    sink: (line: string) => void = (s) => {
      // Structured line so tests can capture without console side-effect.
      process.stdout.write(`${s}\n`);
    },
  ) {
    this.sink = sink;
  }

  async publish(alert: Alert): Promise<void> {
    this.sink(JSON.stringify({ level: 30, msg: "anomaly", ...alert }));
  }
}
