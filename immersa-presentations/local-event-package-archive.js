const path = require("node:path");
const fs = require("node:fs");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { verifyPackage } = require("./local-event-package-storage");

const exec = promisify(execFile);

async function createArchive({ packageRoot, destination }) {
  await verifyPackage(packageRoot);
  const source = path.resolve(packageRoot);
  const output = path.resolve(destination);
  await fs.promises.mkdir(path.dirname(output), { recursive: true });
  await fs.promises.rm(output, { force: true });
  await exec("zip", ["-q", "-r", output, "."], { cwd: source });
  return output;
}

async function extractArchive({ archive, destination }) {
  const source = path.resolve(archive);
  const output = path.resolve(destination);
  const { stdout } = await exec("unzip", ["-Z", "-1", source]);
  for (const entry of String(stdout).split(/\r?\n/).filter(Boolean)) {
    const normalized = entry.replace(/\\/g, "/");
    if (normalized.startsWith("/") || normalized.split("/").includes("..")) {
      throw new Error("Invalid Local package archive path");
    }
  }
  await fs.promises.rm(output, { recursive: true, force: true });
  await fs.promises.mkdir(output, { recursive: true });
  await exec("unzip", ["-q", source, "-d", output]);
  return verifyPackage(output);
}

module.exports = { createArchive, extractArchive };
