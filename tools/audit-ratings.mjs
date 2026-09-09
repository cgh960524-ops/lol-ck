import { readFile, readdir } from "node:fs/promises";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const backupRoot = new URL("../backups/", import.meta.url);
const snapshots = (await readdir(backupRoot)).sort();
const selected = process.argv[2] || snapshots.at(-1);
if (!selected) throw new Error("No production snapshot found.");

const state = JSON.parse(await readFile(new URL(`${selected}/app-state.json`, backupRoot), "utf8"));
const matches = JSON.parse(await readFile(new URL(`${selected}/internal-matches.json`, backupRoot), "utf8"));
const source = await readFile(new URL("client.js", root), "utf8");
const calculator = source.slice(0, source.indexOf("function renderPlayers"));
const storage = new Map([
  ["naejeon-lab-players-v1", JSON.stringify(state.players || [])],
  ["naejeon-lab-matches-v1", JSON.stringify(matches)],
  ["naejeon-lab-series-v1", JSON.stringify(state.seriesState || { active: null, history: [] })],
]);
const context = {
  console,
  Intl,
  Date,
  setTimeout: () => 0,
  clearTimeout: () => {},
  queueMicrotask: () => {},
  document: { querySelector: () => null },
  localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key),
  },
};
vm.createContext(context);
vm.runInContext(`${calculator}\nrecalculateRatings();globalThis.result=players;`, context);

const before = new Map((state.players || []).map(player => [player.id, player]));
const rows = context.result
  .filter(player => player.internalGames)
  .map(player => ({
    id: player.id,
    name: player.name,
    before: before.get(player.id)?.internalRating,
    after: player.internalRating,
    delta: player.internalRating - (before.get(player.id)?.internalRating || 0),
    games: player.internalGames,
    kda: player.internalKda,
  }))
  .sort((a, b) => b.after - a.after);

console.table(rows);
if (process.argv.includes("--json")) console.log(JSON.stringify(context.result));
if (process.argv.includes("--apply")) {
  const response = await fetch("https://lol-ck.vercel.app/api/app-state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      players: context.result,
      seriesState: state.seriesState,
      ladderChoice: state.ladderChoice || null,
    }),
  });
  if (!response.ok) throw new Error(`Apply failed: HTTP ${response.status} ${await response.text()}`);
  console.log("Applied recalculated ratings to production app-state.");
}
