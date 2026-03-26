import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runDeploy } from "./deploy.mjs";
import { runPostbuild } from "./postbuild.mjs";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

let syncRunning = false;
let syncPending = false;

async function syncBuildOutput() {
  if (syncRunning) {
    syncPending = true;
    return;
  }

  syncRunning = true;

  do {
    syncPending = false;

    try {
      runPostbuild();
      runDeploy();
    }
    catch (error) {
      console.error("[dev:obsidian] Sync failed");
      console.error(error);
    }
  } while (syncPending);

  syncRunning = false;
}

function pipeOutput(stream, writer, onLine) {
  let buffer = "";

  stream.on("data", (chunk) => {
    const text = chunk.toString();
    writer.write(text);
    buffer += text;

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      onLine(line);
    }
  });

  stream.on("end", () => {
    if (buffer) {
      onLine(buffer);
    }
  });
}

function handleBuildLine(line) {
  if (line.includes("built in")) {
    void syncBuildOutput();
  }
}

const viteWatch = spawn(npmCommand, ["run", "dev"], {
  cwd: rootDir,
  stdio: ["inherit", "pipe", "pipe"],
});

pipeOutput(viteWatch.stdout, process.stdout, handleBuildLine);
pipeOutput(viteWatch.stderr, process.stderr, () => {});

viteWatch.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

for (const event of ["SIGINT", "SIGTERM"]) {
  process.on(event, () => {
    viteWatch.kill(event);
  });
}
