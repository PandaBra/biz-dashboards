import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const viteCli = path.join(projectDir, "node_modules", "vite", "bin", "vite.js");
const children = [
  spawn(process.execPath, [path.join(projectDir, "server", "index.js")], {
    cwd: projectDir,
    stdio: "inherit",
    env: process.env,
  }),
  spawn(process.execPath, [viteCli], {
    cwd: projectDir,
    stdio: "inherit",
    env: process.env,
  }),
];

let shuttingDown = false;

function stopChildren(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
  process.exitCode = exitCode;
}

for (const child of children) {
  child.on("error", (error) => {
    console.error("Dev-Server konnte nicht gestartet werden:", error);
    stopChildren(1);
  });
  child.on("exit", (code) => {
    if (!shuttingDown) stopChildren(code || 0);
  });
}

process.on("SIGINT", () => stopChildren(0));
process.on("SIGTERM", () => stopChildren(0));
