import test from "node:test";
import assert from "node:assert/strict";
import {
  PUBLIC_RATING_HISTORY_LIMIT,
  projectPublicAppState,
} from "../public-state.mjs";

const event = index => ({
  gameId: String(8_000_000_000 + index),
  seriesId: `CKS-${index}`,
  time: index,
  version: "matchup-skill-v4.1",
  role: "SUPPORT",
  win: index % 2 === 0,
  before: 1500 + index,
  after: 1501 + index,
  roleBefore: 1510 + index,
  roleAfter: 1512 + index,
  roleChange: 2,
  opponentId: 99,
  opponentPower: 1600,
  expectedPerformance: 0.42,
  actualMatchup: 0.55,
  quality: 0.87,
  reason: "above",
  excludedMetrics: ["protection"],
  metrics: [
    { key: "vision", label: "시야", signal: 0.7, paired: 0.4, weight: 0.18 },
  ],
});

test("projects compact rating events without mutating state", () => {
  const state = {
    version: 7,
    players: [{
      id: 1,
      name: "테스트 선수",
      ratingV2: { overall: 1555, roles: { SUPPORT: { rating: 1610 } } },
      internalChampions: { "SUPPORT|Thresh": { name: "Thresh", games: 8 } },
      ratingHistory: Array.from({ length: 8 }, (_, index) => event(index)),
    }],
    seriesState: { active: null, history: [{ id: "series-1" }] },
    discordRecruitment: { id: "recruitment-1" },
    ladderChoice: { mode: "role" },
    ratingAlgorithm: { version: "v4.1" },
    customTopLevelMetadata: { retained: true },
  };
  const original = structuredClone(state);

  const projected = projectPublicAppState(state);

  assert.deepEqual(state, original);
  assert.notStrictEqual(projected, state);
  assert.notStrictEqual(projected.players, state.players);
  assert.notStrictEqual(projected.players[0], state.players[0]);
  assert.deepEqual(projected.seriesState, state.seriesState);
  assert.deepEqual(projected.discordRecruitment, state.discordRecruitment);
  assert.deepEqual(projected.ladderChoice, state.ladderChoice);
  assert.deepEqual(projected.ratingAlgorithm, state.ratingAlgorithm);
  assert.deepEqual(projected.customTopLevelMetadata, state.customTopLevelMetadata);
  assert.deepEqual(projected.players[0].ratingV2, state.players[0].ratingV2);
  assert.deepEqual(projected.players[0].internalChampions, state.players[0].internalChampions);

  assert.equal(projected.players[0].ratingHistory.length, 8);
  assert.deepEqual(
    projected.players[0].ratingHistory.map(row => row.gameId),
    state.players[0].ratingHistory.map(row => row.gameId),
  );
  for (const [index, row] of projected.players[0].ratingHistory.entries()) {
    assert.equal(Object.hasOwn(row, "metrics"), false);
    assert.equal(row.gameId, state.players[0].ratingHistory[index].gameId);
    assert.equal(row.roleChange, state.players[0].ratingHistory[index].roleChange);
  }
});

test("production-scale rating diagnostics project below the Vercel response limit", () => {
  const heavyMetrics = Array.from({ length: 8 }, (_, index) => ({
    key: `metric-${index}`,
    label: "진단 지표",
    detail: "x".repeat(256),
    signal: index / 10,
    paired: index / 20,
    weight: 0.1,
  }));
  const state = {
    version: 1,
    players: Array.from({ length: 40 }, (_, playerIndex) => ({
      id: playerIndex + 1,
      name: `player-${playerIndex + 1}`,
      ratingV2: { overall: 1400 + playerIndex, roles: {} },
      internalChampions: { test: { games: 120 } },
      ratingHistory: Array.from({ length: 120 }, (_, historyIndex) => ({
        ...event(historyIndex),
        metrics: heavyMetrics,
      })),
    })),
    seriesState: { active: null, history: [] },
    discordRecruitment: null,
    ladderChoice: { mode: "balanced" },
  };

  const sourceBytes = Buffer.byteLength(JSON.stringify(state));
  const projected = projectPublicAppState(state);
  const projectedBytes = Buffer.byteLength(JSON.stringify(projected));

  assert.ok(sourceBytes > 4_500_000, `fixture should exceed 4.5 MB, got ${sourceBytes}`);
  assert.ok(projectedBytes < 4_500_000, `projection should fit below 4.5 MB, got ${projectedBytes}`);
  assert.ok(projectedBytes < sourceBytes * 0.1);
  assert.ok(projected.players.every(player => player.ratingHistory.length === 120));
  assert.ok(projected.players.every(player => player.ratingHistory.every(row => !Object.hasOwn(row, "metrics"))));
});

test("keeps the original top-level shape when players is absent", () => {
  const state = { version: 1, seriesState: { active: null, history: [] } };
  const projected = projectPublicAppState(state);

  assert.deepEqual(projected, state);
  assert.equal(Object.hasOwn(projected, "players"), false);
  assert.notStrictEqual(projected, state);
});
