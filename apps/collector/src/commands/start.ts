import { daemonStart } from "../daemon";

export async function runStart(): Promise<void> {
  const res = daemonStart();
  console.log(`bematist: ${res.summary}`);
  console.log(`bematist: unit file → ${res.unitPath}`);
  if (res.state === "running") {
    console.log("bematist: tail logs with `bematist logs` or `bematist status`.");
  }
  process.exit(res.state === "running" ? 0 : 1);
}
