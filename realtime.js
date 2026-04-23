// ============================================================
//  REALTIME.JS — Firebase Realtime DB wrapper
// ============================================================
import { initializeApp }               from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, set, get,
         update, onValue, push, remove } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { FIREBASE_CONFIG, DB_PATHS }   from "./config.js";

const app = initializeApp(FIREBASE_CONFIG);
const db  = getDatabase(app);

// ── Helpers ──────────────────────────────────────────────────
const matchRef  = (matchId) => ref(db, `${DB_PATHS.matches}/${matchId}`);
const playerRef = (matchId, pid) =>
  ref(db, `${DB_PATHS.matches}/${matchId}/${DB_PATHS.players}/${pid}`);
const stateRef  = (matchId) =>
  ref(db, `${DB_PATHS.matches}/${matchId}/${DB_PATHS.gameState}`);

// ── Match lifecycle ───────────────────────────────────────────
export async function createMatch(matchId, hostId, settings) {
  await set(matchRef(matchId), {
    host: hostId,
    settings,
    phase: "lobby",
    createdAt: Date.now(),
    lastActivity: Date.now(),
  });
}

/**
 * Delete any matches older than maxAgeMs that are still in lobby phase.
 * Call on app startup to prevent stale lobby data accumulating.
 */
export async function cleanupStaleMatches(maxAgeMs = 2 * 60 * 60 * 1000) {
  const snap = await get(ref(db, DB_PATHS.matches));
  const all  = snap.val() ?? {};
  const now  = Date.now();
  const ops  = [];
  for (const [id, match] of Object.entries(all)) {
    const age = now - (match.lastActivity ?? match.createdAt ?? 0);
    if (age > maxAgeMs) ops.push(remove(ref(db, `${DB_PATHS.matches}/${id}`)));
  }
  if (ops.length) await Promise.all(ops);
}

export async function joinMatch(matchId, player) {
  await set(playerRef(matchId, player.id), {
    ...player,
    role: null,
    alive: true,
    x: 0, y: 0,
    shield: null,
    killReady: false,
    jesterSwapsLeft: 0,
    meetingCallsLeft: 0,
    completedRooms: {},   // { [roomId]: true } — task completion tracking
  });
}

export async function getMatchSettings(matchId) {
  const snap = await get(ref(db, `${DB_PATHS.matches}/${matchId}/settings`));
  return snap.val() ?? {};
}

export async function getPlayerData(matchId, playerId) {
  const snap = await get(playerRef(matchId, playerId));
  return snap.val();
}

// ── Game state mutations ──────────────────────────────────────
export async function assignRoles(matchId, roleMap) {
  const updates = {};
  for (const [pid, role] of Object.entries(roleMap)) {
    updates[`${DB_PATHS.matches}/${matchId}/${DB_PATHS.players}/${pid}/role`] = role;
    if (role === "impostor") {
      updates[`${DB_PATHS.matches}/${matchId}/${DB_PATHS.players}/${pid}/killReady`] = false;
    }
    // Set meetingCallsLeft from settings
    updates[`${DB_PATHS.matches}/${matchId}/${DB_PATHS.players}/${pid}/meetingCallsLeft`] = 1;
  }
  await update(ref(db), updates);
}

export async function setPhase(matchId, phase) {
  await update(stateRef(matchId), { phase });
}

/** Broadcast game-over result to all clients. */
export async function setGameResult(matchId, winner) {
  await update(stateRef(matchId), { phase: "ended", winner });
}

/** Subscribe to full game-state changes (phase + winner). */
export function onGameStateChange(matchId, cb) {
  return onValue(stateRef(matchId), snap => cb(snap.val() ?? {}));
}

/** Read all current players once (for name deduplication etc). */
export async function getMatchPlayers(matchId) {
  const snap = await get(ref(db, `${DB_PATHS.matches}/${matchId}/${DB_PATHS.players}`));
  return snap.val() ?? {};
}

/** Delete the entire match from Firebase. */
export async function deleteMatch(matchId) {
  await remove(matchRef(matchId));
}

export async function movePlayer(matchId, playerId, x, y) {
  await update(playerRef(matchId, playerId), { x, y });
}

export async function setKillReady(matchId, impostorId, ready) {
  await update(playerRef(matchId, impostorId), { killReady: ready });
}

export async function applyKill(matchId, targetId) {
  await update(playerRef(matchId, targetId), { alive: false });
  await set(ref(db, `${DB_PATHS.matches}/${matchId}/${DB_PATHS.deadZone}/${targetId}`), true);
}

export async function applyJesterSwap(matchId, jesterId, impostorId) {
  const [jSnap, iSnap] = await Promise.all([
    get(playerRef(matchId, jesterId)),
    get(playerRef(matchId, impostorId)),
  ]);
  const jPos = jSnap.val();
  const iPos = iSnap.val();
  await update(playerRef(matchId, jesterId),   { x: iPos.x, y: iPos.y });
  await update(playerRef(matchId, impostorId), { x: jPos.x, y: jPos.y });
  return { jesterNewPos: { x: iPos.x, y: iPos.y } };
}

export async function applyShield(matchId, playerId, shieldObj) {
  await update(playerRef(matchId, playerId), { shield: shieldObj });
}

export async function breakShield(matchId, playerId) {
  await update(playerRef(matchId, playerId), { shield: null });
}

/**
 * Mark a task room as complete for this player.
 * Stored under players/{pid}/completedRooms/{roomId}: true
 */
export async function completeRoomTask(matchId, playerId, roomId) {
  // Sanitize room id for Firebase key (room ids are safe already, but just in case)
  const safeId = roomId.replace(/[.#$\[\]/]/g, "_");
  await update(playerRef(matchId, playerId), {
    [`completedRooms/${safeId}`]: true,
  });
}

// ── Meeting / voting ──────────────────────────────────────────
export async function callMeeting(matchId, callerId, reason) {
  await set(ref(db, `${DB_PATHS.matches}/${matchId}/${DB_PATHS.meetings}/active`), {
    calledBy: callerId,
    reason,
    calledAt: Date.now(),
    phase: "discussion",
    votes: {},
    chat: {},
  });

  // Decrement meetingCallsLeft properly
  const snap    = await get(playerRef(matchId, callerId));
  const current = snap.val()?.meetingCallsLeft ?? 1;
  await update(playerRef(matchId, callerId), {
    meetingCallsLeft: Math.max(0, current - 1),
  });
}

export async function castVote(matchId, voterId, targetId) {
  await update(
    ref(db, `${DB_PATHS.matches}/${matchId}/${DB_PATHS.meetings}/active/votes`),
    { [voterId]: targetId }
  );
}

export async function sendChatMessage(matchId, playerId, playerName, color, text) {
  const chatRef = ref(db, `${DB_PATHS.matches}/${matchId}/${DB_PATHS.meetings}/active/chat`);
  await push(chatRef, { playerId, playerName, color, text, ts: Date.now() });
}

export function onChatMessage(matchId, cb) {
  return onValue(
    ref(db, `${DB_PATHS.matches}/${matchId}/${DB_PATHS.meetings}/active/chat`),
    snap => {
      const raw  = snap.val() ?? {};
      const msgs = Object.values(raw).sort((a, b) => a.ts - b.ts);
      cb(msgs);
    }
  );
}

// ── Subscriptions ─────────────────────────────────────────────
export function onPlayersChange(matchId, cb) {
  return onValue(
    ref(db, `${DB_PATHS.matches}/${matchId}/${DB_PATHS.players}`),
    (snap) => cb(snap.val())
  );
}

export function onPhaseChange(matchId, cb) {
  return onValue(stateRef(matchId), (snap) => cb(snap.val()?.phase));
}

export function onMeetingChange(matchId, cb) {
  return onValue(
    ref(db, `${DB_PATHS.matches}/${matchId}/${DB_PATHS.meetings}/active`),
    (snap) => cb(snap.val())
  );
}