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
    settings,                        // { discussionTime, votingTime, meetingCalls, useChat }
    phase: "lobby",                  // lobby | playing | meeting | ended
    createdAt: Date.now(),
  });
}

export async function joinMatch(matchId, player) {
  // player: { id, name, avatar }
  await set(playerRef(matchId, player.id), {
    ...player,
    role: null,        // assigned on game start: "crew" | "impostor" | "jester"
    alive: true,
    x: 0, y: 0,       // position on the map canvas
    shield: null,      // null | { type: "full"|"low", chance: 0.50|0.05|0.15 }
    killReady: false,  // impostor only
    jesterSwapsLeft: 0,// jester only — counted up as SQs are answered
    meetingCallsLeft: 0,// set from settings on game start
  });
}

/**
 * Fetch the settings object stored on the match node.
 * Useful for non-host players who need to read them on game start.
 */
export async function getMatchSettings(matchId) {
  const snap = await get(ref(db, `${DB_PATHS.matches}/${matchId}/settings`));
  return snap.val() ?? {};
}

/**
 * Fetch a single player's data snapshot once.
 */
export async function getPlayerData(matchId, playerId) {
  const snap = await get(playerRef(matchId, playerId));
  return snap.val();
}

// ── Game state mutations ──────────────────────────────────────
export async function assignRoles(matchId, roleMap) {
  // roleMap: { [playerId]: "crew"|"impostor"|"jester" }
  const updates = {};
  for (const [pid, role] of Object.entries(roleMap)) {
    updates[`${DB_PATHS.matches}/${matchId}/${DB_PATHS.players}/${pid}/role`] = role;
    if (role === "impostor") {
      updates[`${DB_PATHS.matches}/${matchId}/${DB_PATHS.players}/${pid}/killReady`] = false;
    }
  }
  await update(ref(db), updates);
}

export async function setPhase(matchId, phase) {
  // phase: "lobby" | "playing" | "meeting" | "ended"
  await update(stateRef(matchId), { phase });
}

export async function movePlayer(matchId, playerId, x, y) {
  await update(playerRef(matchId, playerId), { x, y });
}

export async function setKillReady(matchId, impostorId, ready) {
  await update(playerRef(matchId, impostorId), { killReady: ready });
}

export async function applyKill(matchId, targetId) {
  // Returns true if kill lands (shield logic handled client-side before calling)
  await update(playerRef(matchId, targetId), { alive: false });
  // move to dead zone
  await set(ref(db, `${DB_PATHS.matches}/${matchId}/${DB_PATHS.deadZone}/${targetId}`), true);
}

export async function applyJesterSwap(matchId, jesterId, impostorId) {
  // Teleport jester to impostor's position and vice versa
  const [jSnap, iSnap] = await Promise.all([
    get(playerRef(matchId, jesterId)),
    get(playerRef(matchId, impostorId)),
  ]);
  const jPos = jSnap.val();
  const iPos = iSnap.val();
  await update(playerRef(matchId, jesterId),   { x: iPos.x, y: iPos.y });
  await update(playerRef(matchId, impostorId), { x: jPos.x, y: jPos.y });
}

export async function applyShield(matchId, playerId, shieldObj) {
  // shieldObj: { type: "full"|"low"|"lq", chance: 0.50|0.05|0.15 }
  // Crew can only have one shield — overwrite
  await update(playerRef(matchId, playerId), { shield: shieldObj });
}

export async function breakShield(matchId, playerId) {
  await update(playerRef(matchId, playerId), { shield: null });
}

// ── Meeting / voting ──────────────────────────────────────────
export async function callMeeting(matchId, callerId, reason) {
  // reason: "corpse" | "zone_lq"
  await set(ref(db, `${DB_PATHS.matches}/${matchId}/${DB_PATHS.meetings}/active`), {
    calledBy: callerId,
    reason,
    calledAt: Date.now(),
    phase: "discussion",  // discussion | voting | closed
    votes: {},
    chat: {},
  });

  // BUG FIX: properly decrement meetingCallsLeft instead of setting to null
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

/**
 * Send a chat message during a meeting.
 * Stored under meetings/active/chat/{pushId}
 */
export async function sendChatMessage(matchId, playerId, playerName, color, text) {
  const chatRef = ref(
    db,
    `${DB_PATHS.matches}/${matchId}/${DB_PATHS.meetings}/active/chat`
  );
  await push(chatRef, {
    playerId,
    playerName,
    color,
    text,
    ts: Date.now(),
  });
}

/**
 * Subscribe to live chat messages during a meeting.
 * cb receives an array of { playerId, playerName, color, text, ts }
 * sorted by timestamp.
 */
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

// ── Subscriptions (call in components) ───────────────────────
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