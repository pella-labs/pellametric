import { daemonStop } from "../daemon";

export async function runStop(): Promise<void> {
  const _res = daemonStop();
  process.exit(0);
}
