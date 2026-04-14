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
  });
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
  });
}

/** Read match settings (and host) from Firebase. Non-hosts call this on game start. */
export async function getMatchSettings(matchId) {
  const snap = await get(matchRef(matchId));
  return snap.val()?.settings ?? {};
}

// ── Game state mutations ──────────────────────────────────────
export async function assignRoles(matchId, roleMap) {
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
  await update(stateRef(matchId), { phase });
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
}

export async function applyShield(matchId, playerId, shieldObj) {
  await update(playerRef(matchId, playerId), { shield: shieldObj });
}

export async function breakShield(matchId, playerId) {
  await update(playerRef(matchId, playerId), { shield: null });
}

// ── Meeting / voting ──────────────────────────────────────────
export async function callMeeting(matchId, callerId, reason) {
  await set(ref(db, `${DB_PATHS.matches}/${matchId}/${DB_PATHS.meetings}/active`), {
    calledBy: callerId,
    reason,
    calledAt: Date.now(),
    phase: "discussion",
    votes: {},
  });
  await update(playerRef(matchId, callerId), { meetingCallsLeft: null });
}

export async function castVote(matchId, voterId, targetId) {
  await update(
    ref(db, `${DB_PATHS.matches}/${matchId}/${DB_PATHS.meetings}/active/votes`),
    { [voterId]: targetId }
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