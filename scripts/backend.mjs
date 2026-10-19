import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const service = path.join(root, "services/navigation");
const python = path.join(service, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
if (!existsSync(python)) {
  console.error("Backend environment missing. Follow docs/DEVELOPMENT.md to create and install it.");
  process.exit(1);
}
const commands = {
  dev: ["-m", "uvicorn", "darkstar_navigation.main:app", "--reload", "--host", "127.0.0.1"],
  test: ["-m", "pytest"],
  lint: ["-m", "ruff", "check", "."],
};
const args = commands[process.argv[2]];
if (!args) {
  console.error("Usage: node scripts/backend.mjs <dev|test|lint>");
  process.exit(1);
}
const result = spawnSync(python, args, { cwd: service, stdio: "inherit" });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
