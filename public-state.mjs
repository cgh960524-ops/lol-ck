/**
 * Keep the public app-state response small without changing the persisted state.
 *
 * Usage:
 *   return json(res, 200, projectPublicAppState(await loadAppState()));
 */
export const PUBLIC_RATING_HISTORY_LIMIT = 120;

// Keep every field used by the score-change evidence and history chart, but
// omit the much larger calculation diagnostics and other server-only details.
const PUBLIC_RATING_EVENT_FIELDS = [
  "gameId", "seriesId", "time", "version", "role", "win",
  "before", "after", "roleBefore", "roleAfter", "roleChange",
  "opponentId", "opponentPower", "expectedPerformance", "actualMatchup",
  "quality", "reason", "matchupChange", "referenceChange", "capAdjustment",
  "opponentReliability", "acceleration", "defensive", "seriesSource",
  "duoContextApplied", "duoChange", "partnerAdjustment", "timelineContextApplied", "timelineChange", "performanceChange", "seriesGuardrailAdjustment",
];

function projectRatingEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return event;

  const publicEvent = {};
  for (const field of PUBLIC_RATING_EVENT_FIELDS) {
    if (Object.hasOwn(event, field)) publicEvent[field] = event[field];
  }
  return publicEvent;
}

export function projectPublicAppState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return state;

  const publicState = { ...state };
  delete publicState.seriesAuditLog;
  if (!Array.isArray(state.players)) return publicState;

  publicState.players = state.players.map(player => {
    if (!player || typeof player !== "object" || Array.isArray(player)) return player;

    const publicPlayer = { ...player };
    if (Array.isArray(player.ratingHistory)) {
      publicPlayer.ratingHistory = player.ratingHistory
        .slice(-PUBLIC_RATING_HISTORY_LIMIT)
        .map(projectRatingEvent);
    }
    return publicPlayer;
  });

  return publicState;
}
