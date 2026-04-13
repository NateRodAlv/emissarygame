// ============================================================
//  ROLES.JS — Role behaviour skeletons
// ============================================================
import { GAME_CONFIG } from "./config.js";
import { fetchSQ, fetchLQ } from "./questions.js";
import {
  setKillReady, applyKill, applyJesterSwap,
  applyShield, breakShield
} from "./realtime.js";

// ── IMPOSTOR ─────────────────────────────────────────────────
export const Impostor = {
  killReady: false,
  sqAnsweredCount: 0,

  /** Call when impostor answers an SQ correctly. */
  async onSqCorrect(matchId, playerId) {
    this.sqAnsweredCount++;
    if (this.sqAnsweredCount >= GAME_CONFIG.killCostSq) {
      this.killReady = true;
      this.sqAnsweredCount = 0;
      await setKillReady(matchId, playerId, true);
      // TODO: show "Kill Ready" UI indicator to impostor
    }
  },

  /**
   * Attempt to kill a target.
   * Shield check happens here — impostor is notified if blocked.
   */
  async attemptKill(matchId, impostorId, target) {
    if (!this.killReady) return { result: "no_preload" };

    // Shield check
    if (target.shield) {
      const blocked = Math.random() < target.shield.chance;
      if (blocked) {
        await setKillReady(matchId, impostorId, false);
        this.killReady = false;
        // TODO: notify IMPOSTOR their kill was blocked (don't notify crew)
        return { result: "blocked" };
      }
    }

    await applyKill(matchId, target.id);
    this.killReady = false;
    await setKillReady(matchId, impostorId, false);
    return { result: "killed" };
  },
};

// ── JESTER ───────────────────────────────────────────────────
export const Jester = {
  sqAnsweredCount: 0,

  /** Call when jester answers an SQ correctly. */
  async onSqCorrect(matchId, jesterId, impostorPos) {
    this.sqAnsweredCount++;
    // TODO: show swap progress bar to jester
    // TODO: show preview of impostor's location (impostorPos {x,y}) to jester
    if (this.sqAnsweredCount >= GAME_CONFIG.jesterSwapCostSq) {
      // TODO: confirm swap UI
    }
  },

  /** Trigger the swap. */
  async triggerSwap(matchId, jesterId, impostorId) {
    if (this.sqAnsweredCount < GAME_CONFIG.jesterSwapCostSq) return;
    await applyJesterSwap(matchId, jesterId, impostorId);
    this.sqAnsweredCount = 0;
    // TODO: victory condition — if jester gets voted out → jester wins
  },
};

// ── CREW ─────────────────────────────────────────────────────
export const Crew = {
  tasksCompleted: 0,

  /** Call after a crew member successfully completes a task. */
  async onTaskComplete(matchId, playerId) {
    this.tasksCompleted++;
    const shield = {
      type: "full",
      chance: GAME_CONFIG.crewShieldChance,
    };
    await applyShield(matchId, playerId, shield);
    // NOTE: crew is NOT notified if impostor tries to kill them (blocked silently)
    // TODO: show shield icon on HUD
    // TODO: check win condition: all tasks done → crew wins
  },
};

// ── DEAD ─────────────────────────────────────────────────────
export const Dead = {
  wasImpostor: false, // set to true if this player was impostor when they died

  /**
   * Dead player answers SQ → give low shield to target crew member.
   * Dead player answers LQ → give medium shield to target crew member.
   * A crew member can only hold one shield (latest overwrites).
   */
  async giveShield(matchId, targetId, questionType) {
    const chance =
      questionType === "lq"
        ? GAME_CONFIG.ghostShieldLqChance
        : GAME_CONFIG.ghostShieldSqChance;
    const shield = { type: "ghost", chance };
    await applyShield(matchId, targetId, shield);
    // TODO: UI — let dead player choose which alive crew member gets the shield
  },

  /** Ex-impostor ghost: give teammate a shieldbreaker (costs 2 SQ). */
  async giveShieldBreaker(matchId, targetImpostorId, sqAnsweredCount) {
    if (!this.wasImpostor) return;
    if (sqAnsweredCount < GAME_CONFIG.ghostShieldBreakerCostSq) return;
    // Next kill from targetImpostorId ignores any shield
    // TODO: store shieldBreaker flag on the impostor's player node
    //       and consume it in Impostor.attemptKill()
  },

  /** Ex-impostor ghost: grant extra kill (costs 3 LQ). */
  async grantExtraKill(matchId, targetImpostorId, lqAnsweredCount) {
    if (!this.wasImpostor) return;
    if (lqAnsweredCount < GAME_CONFIG.ghostExtraKillCostLq) return;
    // TODO: increment impostor's extraKills counter in Firebase
    //       and allow kill even without SQ preload
  },

  /**
   * Role visibility rule:
   * Dead players don't know roles UNLESS they were impostor.
   * If wasImpostor, they can see the current impostor's location.
   */
  canSeeRole(targetRole) {
    return this.wasImpostor;
  },
};
