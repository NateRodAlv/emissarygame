// ============================================================
//  ROLES.JS — Role behaviour
// ============================================================
import { GAME_CONFIG } from "./config.js";
import { fetchSQ, fetchLQ } from "./questions.js";
import {
  setKillReady, applyKill, applyJesterSwap,
  applyShield, breakShield
} from "./realtime.js";

// ── Event bus (light-weight) ─────────────────────────────────
// index.html can listen: document.addEventListener("game:killReady", e => ...)
const emit = (name, detail = {}) =>
  document.dispatchEvent(new CustomEvent(name, { detail }));


// ── IMPOSTOR ─────────────────────────────────────────────────
export const Impostor = {
  killReady: false,
  sqAnsweredCount: 0,

  /** Call when impostor answers an SQ correctly. */
  async onSqCorrect(matchId, playerId) {
    this.sqAnsweredCount++;
    if (this.sqAnsweredCount >= GAME_CONFIG.killCostSq) {
      this.killReady       = true;
      this.sqAnsweredCount = 0;
      await setKillReady(matchId, playerId, true);
      // Notify HUD that kill is ready
      emit("game:killReady", { playerId });
    } else {
      // Show progress toward next kill
      emit("game:killProgress", {
        playerId,
        progress: this.sqAnsweredCount,
        needed:   GAME_CONFIG.killCostSq,
      });
    }
  },

  /**
   * Attempt to kill a target.
   * Shield check happens here — impostor is notified if blocked,
   * but the victim is NOT notified (silent block).
   */
  async attemptKill(matchId, impostorId, target) {
    if (!this.killReady) {
      emit("game:killFailed", { reason: "no_preload" });
      return { result: "no_preload" };
    }

    // Shield check
    if (target.shield) {
      const blocked = Math.random() < target.shield.chance;
      if (blocked) {
        // Reset kill-ready state
        this.killReady = false;
        await setKillReady(matchId, impostorId, false);
        // Notify IMPOSTOR only — victim is NOT told
        emit("game:killBlocked", { impostorId });
        return { result: "blocked" };
      }
    }

    await applyKill(matchId, target.id);
    this.killReady = false;
    await setKillReady(matchId, impostorId, false);
    emit("game:killLanded", { impostorId, targetId: target.id });
    return { result: "killed" };
  },

  /** Directly reset kill-ready (e.g. after a blocked kill detected client-side). */
  async resetKill(matchId, playerId) {
    this.killReady       = false;
    this.sqAnsweredCount = 0;
    await setKillReady(matchId, playerId, false);
  },
};


// ── JESTER ───────────────────────────────────────────────────
export const Jester = {
  // Ability 1: teleport-swap with impostor (charges via SQ)
  sqAnsweredCount: 0,

  // Ability 2: 10-second color+name disguise (charges via LQ)
  lqAnsweredCount: 0,
  colorSwapReady:  false,

  /** Call when jester answers an SQ correctly. Charges the swap ability. */
  async onSqCorrect(matchId, jesterId, impostorPos) {
    this.sqAnsweredCount++;
    const progress = this.sqAnsweredCount;
    const needed   = GAME_CONFIG.jesterSwapCostSq;

    // Show swap progress to jester
    emit("game:jesterProgress", { jesterId, progress, needed });

    if (progress >= needed) {
      // Show impostor's current location and prompt for swap confirmation
      emit("game:jesterSwapReady", {
        jesterId,
        impostorPos,   // { x, y } — position on the map canvas
      });
    }
  },

  /**
   * Call when jester answers an LQ correctly. Charges the disguise ability.
   * @returns {boolean} true when colorSwap is now ready
   */
  async onLqCorrect(matchId, jesterId) {
    this.lqAnsweredCount++;
    const progress = this.lqAnsweredCount;
    const needed   = GAME_CONFIG.jesterColorSwapLqCost;

    emit("game:jesterLqProgress", { jesterId, progress, needed });

    if (progress >= needed) {
      this.colorSwapReady   = true;
      this.lqAnsweredCount  = 0;
      emit("game:jesterDisguiseReady", { jesterId });
      return true;
    }
    return false;
  },

  /** Trigger the teleport-swap (call after player confirms). */
  async triggerSwap(matchId, jesterId, impostorId) {
    if (this.sqAnsweredCount < GAME_CONFIG.jesterSwapCostSq) return;
    await applyJesterSwap(matchId, jesterId, impostorId);
    this.sqAnsweredCount = 0;
    emit("game:jesterSwapped", { jesterId, impostorId });
    // Victory condition: if jester gets voted out → jester wins.
    // Checked in index.html's checkWinConditions after ejection vote.
  },

  /**
   * Consume the colorSwap charge.
   * Returns true if it was ready (and resets the flag).
   * The caller (index.html) handles Firebase writes and the timer.
   */
  consumeColorSwap() {
    if (!this.colorSwapReady) return false;
    this.colorSwapReady = false;
    return true;
  },
};


// ── CREW ─────────────────────────────────────────────────────
export const Crew = {
  tasksCompleted: 0,

  /** Call after a crew member successfully completes a task. */
  async onTaskComplete(matchId, playerId) {
    this.tasksCompleted++;
    const shield = {
      type:   "full",
      chance: GAME_CONFIG.crewShieldChance,
    };
    await applyShield(matchId, playerId, shield);

    // Show shield icon on HUD
    emit("game:shieldGranted", {
      playerId,
      shieldType: "full",
      chance:     GAME_CONFIG.crewShieldChance,
    });

    // NOTE: crew is NOT notified if a kill is blocked by their shield
    // (the impostor is notified instead — see Impostor.attemptKill)

    // Check all-tasks win condition (simple: track locally)
    emit("game:taskCompleted", { playerId, tasksCompleted: this.tasksCompleted });
  },
};


// ── DEAD ─────────────────────────────────────────────────────
export const Dead = {
  wasImpostor: false, // set to true if this player was impostor when they died

  /**
   * Dead player answers SQ → give low shield to target crew member.
   * Dead player answers LQ → give medium shield to target crew member.
   * A crew member can only hold one shield (latest overwrites).
   *
   * Call this after prompting the dead player to pick a target and
   * passing that target's id as targetId.
   */
  async giveShield(matchId, targetId, questionType) {
    const chance =
      questionType === "lq"
        ? GAME_CONFIG.ghostShieldLqChance
        : GAME_CONFIG.ghostShieldSqChance;
    const shield = { type: "ghost", chance };
    await applyShield(matchId, targetId, shield);
    // Prompt dead player to choose a target via UI
    emit("game:ghostShieldGiven", { targetId, questionType, chance });
  },

  /** Ex-impostor ghost: give teammate a shieldbreaker (costs 2 SQ). */
  async giveShieldBreaker(matchId, targetImpostorId, sqAnsweredCount) {
    if (!this.wasImpostor) return;
    if (sqAnsweredCount < GAME_CONFIG.ghostShieldBreakerCostSq) return;
    // Store shieldBreaker flag on the impostor's player node.
    // Impostor.attemptKill should check & consume this flag before shield rolls.
    const { update } = await import(
      "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js"
    );
    emit("game:shieldBreakerGranted", { targetImpostorId });
    // Actual DB write is left to the caller who has the db reference;
    // emit the event so index.html can write:
    //   update(playerRef(matchId, targetImpostorId), { shieldBreaker: true })
  },

  /** Ex-impostor ghost: grant extra kill (costs 3 LQ). */
  async grantExtraKill(matchId, targetImpostorId, lqAnsweredCount) {
    if (!this.wasImpostor) return;
    if (lqAnsweredCount < GAME_CONFIG.ghostExtraKillCostLq) return;
    // Increment impostor's extraKills counter — allows kill without SQ preload.
    emit("game:extraKillGranted", { targetImpostorId });
    // Actual DB write handled by caller:
    //   update(playerRef(matchId, targetImpostorId), { extraKills: firebase.database.ServerValue.increment(1) })
  },

  /**
   * Role visibility rule:
   * Dead players don't know roles UNLESS they were the impostor.
   */
  canSeeRole(_targetRole) {
    return this.wasImpostor;
  },
};