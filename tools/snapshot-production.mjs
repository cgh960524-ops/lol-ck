import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.CK_APP_URL || "https://lol-ck.vercel.app";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const directory = new URL(`../backups/${stamp}/`, import.meta.url);

async function read(path) {
  const response = await fetch(`${base}${path}`);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  const value = await response.json();
  return typeof value === "string" ? JSON.parse(value) : value;
}

const [appState, internalMatches] = await Promise.all([
  read("/api/app-state"),
  read("/api/internal-matches"),
]);

await mkdir(directory, { recursive: true });
await writeFile(new URL("app-state.json", directory), `${JSON.stringify(appState, null, 2)}\n`);
await writeFile(new URL("internal-matches.json", directory), `${JSON.stringify(internalMatches, null, 2)}\n`);
await writeFile(new URL("manifest.json", directory), `${JSON.stringify({
  createdAt: new Date().toISOString(),
  source: base,
  playerCount: appState.players?.length || 0,
  matchCount: internalMatches.length,
  completedSeries: appState.seriesState?.history?.filter(series => series.finished).length || 0,
}, null, 2)}\n`);

console.log(directory.pathname.replace(/^\/(?:[A-Za-z]:)/, match => match.slice(1)));
