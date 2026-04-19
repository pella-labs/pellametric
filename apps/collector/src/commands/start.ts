import { daemonStart } from "../daemon";

export async function runStart(): Promise<void> {
  const res = daemonStart();
  if (res.state === "running") {
  }
  process.exit(res.state === "running" ? 0 : 1);
}
