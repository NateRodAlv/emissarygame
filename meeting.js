// ============================================================
//  MEETING.JS — Meeting / voting skeleton
// ============================================================
import { GAME_CONFIG }                from "./config.js";
import { fetchLQ }                    from "./questions.js";
import { callMeeting, castVote,
         onMeetingChange, setPhase,
         applyKill }                  from "./realtime.js";

export class MeetingManager {
  constructor(matchId, localPlayer, settings) {
    this.matchId     = matchId;
    this.player      = localPlayer;   // { id, role, alive, meetingCallsLeft }
    this.settings    = settings;      // { discussionTime, votingTime, useChat, meetingCalls }
    this.activeMeeting = null;
    this.discussTimer  = null;
    this.voteTimer     = null;
  }

  // ── Triggering a meeting ────────────────────────────────────

  /** Called when a player clicks/taps a dead body. */
  async reportCorpse(corpsePlayerId) {
    if (!this.player.alive) return;
    // TODO: show "Report?" confirm UI
    await callMeeting(this.matchId, this.player.id, "corpse");
    // corpsePlayerId is available for the discussion UI if you want to show who died
  }

  /**
   * Called when a crew member stands at the Meeting Zone and answers 1 LQ correctly.
   * Host sets a per-player limit on these calls (meetingCalls in settings).
   */
  async callFromZone() {
    if (!this.player.alive) return;
    if (this.player.meetingCallsLeft <= 0) {
      // TODO: show "No meeting calls left" toast
      return;
    }
    const [lq] = await fetchLQ(1);
    // TODO: show LQ question UI and wait for answer
    const correct = await this._presentQuestion(lq);
    if (!correct) return;
    await callMeeting(this.matchId, this.player.id, "zone_lq");
    // decrement meetingCallsLeft in Firebase (handled in realtime.js separately)
  }

  // ── Meeting phases ──────────────────────────────────────────

  /**
   * Subscribe to meeting state changes and drive the UI.
   * Call once after joining a match.
   */
  subscribe() {
    onMeetingChange(this.matchId, (meeting) => {
      if (!meeting) return;
      this.activeMeeting = meeting;
      if (meeting.phase === "discussion") this._startDiscussion(meeting);
      if (meeting.phase === "voting")     this._startVoting(meeting);
      if (meeting.phase === "closed")     this._endMeeting(meeting);
    });
  }

  _startDiscussion(meeting) {
    // TODO: show discussion panel
    // if settings.useChat → show in-game chat box
    // else → show "Discuss in class!" prompt (no in-game chat)
    const timeMs = (this.settings.discussionTime ?? GAME_CONFIG.defaultDiscussionTimeSec) * 1000;
    this.discussTimer = setTimeout(() => this._openVoting(), timeMs);
  }

  _openVoting() {
    clearTimeout(this.discussTimer);
    // TODO: transition discussion UI → voting UI
    // Host (or auto) should update the meeting phase to "voting" in Firebase
    const timeMs = (this.settings.votingTime ?? GAME_CONFIG.defaultVotingTimeSec) * 1000;
    this.voteTimer = setTimeout(() => this._tallyVotes(), timeMs);
  }

  async vote(targetId) {
    if (this.activeMeeting?.phase !== "voting") return;
    await castVote(this.matchId, this.player.id, targetId);
    // TODO: disable vote button after casting
  }

  _startVoting(meeting) {
    // TODO: render player list with vote buttons
    // TODO: show live vote count if desired
  }

  async _tallyVotes() {
    clearTimeout(this.voteTimer);
    const votes = this.activeMeeting?.votes ?? {};
    const tally = {};
    for (const target of Object.values(votes)) {
      tally[target] = (tally[target] ?? 0) + 1;
    }
    // Find player with most votes
    const ejected = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    if (ejected) {
      await applyKill(this.matchId, ejected);
      // TODO: show ejection animation
      // TODO: check win conditions (was ejected the impostor? was it the jester?)
    } else {
      // TODO: show "No one was ejected" screen
    }

    await setPhase(this.matchId, "playing");
  }

  _endMeeting() {
    // TODO: close meeting UI, resume game
  }

  // ── Internal helpers ────────────────────────────────────────

  /** Presents a question modal and resolves to true/false. */
  _presentQuestion(question) {
    return new Promise((resolve) => {
      // TODO: show modal with question.question and an input/choices
      // On submit: resolve(playerAnswer.trim().toLowerCase() === question.answer.trim().toLowerCase())
      resolve(false); // placeholder
    });
  }
}
