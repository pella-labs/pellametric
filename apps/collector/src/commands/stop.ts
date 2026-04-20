import { daemonStop } from "../daemon";

export async function runStop(): Promise<void> {
  const res = daemonStop();
  console.log(`bematist: ${res.summary}`);
  process.exit(0);
}
