// ============================================================
//  CONFIG.JS — ALL CREDENTIALS LIVE HERE
//  Search for ⚠️  to find every value you must change
// ============================================================

// ── SUPABASE ─────────────────────────────────────────────────
// Used for: storing question sets (SQ and LQ)
// Where to find these: supabase.com → your project → Settings → API
export const SUPABASE_URL    = "https://ovavbcgluhqrnkyrqpiv.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im92YXZiY2dsdWhxcm5reXJxcGl2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3NzAzNTksImV4cCI6MjA5MTM0NjM1OX0.yqcMZrHjCbtEuxmN_xSbfvssJnpexEu0ePIyjfYVF4o";

// Table names in your Supabase database
// Change these if you name your tables differently
export const SUPABASE_TABLES = {
  shortQuestions: "short_questions",   // columns expected: id, question, answer, category
  longQuestions:  "long_questions",    // columns expected: id, question, answer, category
};

// ── FIREBASE ─────────────────────────────────────────────────
// Used for: real-time match state (player positions, votes, kills, etc.)
// Where to find these: console.firebase.google.com → your project → Project Settings → Your Apps
export const FIREBASE_CONFIG = {
    apiKey: "AIzaSyB-R-bqtnuAFuzfHix14ryIm98RgjnJWnk",
    authDomain: "amongusedtech.firebaseapp.com",
    projectId: "amongusedtech",
    storageBucket: "amongusedtech.firebasestorage.app",
    messagingSenderId: "62429285560",
    appId: "1:62429285560:web:af223c4ae2660181d8784d",
    measurementId: "G-4KEH0FDY2S"
};

// Firebase RTDB paths — change if you restructure the db
export const DB_PATHS = {
  matches:    "matches",          // matches/{matchId}/...
  players:    "players",          // matches/{matchId}/players/{playerId}/...
  gameState:  "gameState",        // matches/{matchId}/gameState/...
  votes:      "votes",            // matches/{matchId}/votes/...
  meetings:   "meetings",         // matches/{matchId}/meetings/...
  deadZone:   "dead",             // matches/{matchId}/dead/{playerId}/...
};

// ── GAME TUNING ───────────────────────────────────────────────
// Adjust these without touching any logic files
export const GAME_CONFIG = {
  // Shield odds
  // FIX: reduced from 0.50 → 0.30 to balance shield frequency
  crewShieldChance:    0.30,  // 30% — full shield from completed task
  ghostShieldSqChance: 0.05,  // 5%  — low shield from dead player SQ answer
  ghostShieldLqChance: 0.15,  // 15% — higher shield from dead player LQ answer

  // Default role counts (host overrides these in lobby settings)
  impostors: 1,
  jesters:   1,

  // Impostor kill costs
  killCostSq: 1,              // SQs needed to preload one kill

  // Jester swap cost
  jesterSwapCostSq: 3,        // SQs needed to trigger swap

  // Ghost power costs
  ghostShieldBreakerCostSq: 2,  // SQs for a shieldbreaker
  ghostExtraKillCostLq: 3,      // LQs for an extra kill (3x normal)

  // Meeting settings (host can override in lobby)
  defaultDiscussionTimeSec: 120,
  defaultVotingTimeSec:     60,
  defaultMeetingZoneCallsPerPlayer: 1,

  // Task / question draw counts per minigame round
  swipeCategorizeSqCount: 3,
  connectorLqCount: 4,
  fruitNinjaSqCount: 4,
};