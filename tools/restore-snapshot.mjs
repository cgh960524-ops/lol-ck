import { readFile } from "node:fs/promises";

const snapshot = process.argv[2];
if (!snapshot) throw new Error("Usage: node tools/restore-snapshot.mjs <snapshot-folder>");
const root = new URL(`../backups/${snapshot}/`, import.meta.url);
const state = JSON.parse(await readFile(new URL("app-state.json", root), "utf8"));
const matches = JSON.parse(await readFile(new URL("internal-matches.json", root), "utf8"));
const base = process.env.CK_APP_URL || "https://lol-ck.vercel.app";

for (const [path, method, body] of [
  ["/api/app-state", "PUT", { players: state.players, seriesState: state.seriesState, ladderChoice: state.ladderChoice || null }],
  ...matches.map(match => ["/api/internal-matches/upload", "POST", match]),
]) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(process.env.UPLOAD_TOKEN ? { Authorization: `Bearer ${process.env.UPLOAD_TOKEN}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${await response.text()}`);
}
console.log(`Restored ${state.players?.length || 0} players and ${matches.length} matches from ${snapshot}.`);
