// ============================================================
//  MEETING.JS — Meeting / voting  (standalone class)
//
//  Usage:
//    const mgr = new MeetingManager(matchId, localPlayer, settings);
//    mgr.subscribe();                       // wire up Firebase listener
//    mgr.reportCorpse(deadPlayerId);        // call from "Report" button
//    mgr.callFromZone();                    // call from Meeting Zone button
// ============================================================
import { GAME_CONFIG }                from "./config.js";
import { fetchLQ }                    from "./questions.js";
import { callMeeting, castVote,
         onMeetingChange, setPhase,
         applyKill, sendChatMessage,
         onChatMessage }              from "./realtime.js";

export class MeetingManager {
  constructor(matchId, localPlayer, settings, allPlayersRef) {
    this.matchId       = matchId;
    this.player        = localPlayer;   // { id, name, color, role, alive, meetingCallsLeft }
    this.settings      = settings;      // { discussionTime, votingTime, useChat, meetingCalls }
    this.allPlayersRef = allPlayersRef; // () => current allPlayers snapshot object
    this.activeMeeting = null;
    this._discussTimer = null;
    this._voteTimer    = null;
    this._hasVoted     = false;
    this._chatUnsub    = null;
    this._overlay      = null;          // the DOM overlay element
  }

  // ── Triggering a meeting ────────────────────────────────────

  /** Called when a player clicks/taps a dead body. */
  async reportCorpse(corpsePlayerId) {
    if (!this.player.alive) return;
    const deadName = this.allPlayersRef()?.[corpsePlayerId]?.name ?? "someone";
    const ok = await this._confirm(`Report ${deadName}'s body and call an emergency meeting?`);
    if (!ok) return;
    await callMeeting(this.matchId, this.player.id, "corpse");
    await setPhase(this.matchId, "meeting");
  }

  /**
   * Called when a crew member stands at the Meeting Zone.
   * Requires answering 1 LQ correctly to call the meeting.
   * Host sets a per-player limit in settings.meetingCalls.
   */
  async callFromZone() {
    if (!this.player.alive) return;
    if ((this.player.meetingCallsLeft ?? 0) <= 0) {
      this._toast("No meeting calls left!");
      return;
    }
    const [lq] = await fetchLQ(1);
    const correct = await this._presentQuestion(lq, "◈ ANSWER TO CALL MEETING");
    if (!correct) {
      this._toast("Wrong answer — meeting not called.");
      return;
    }
    await callMeeting(this.matchId, this.player.id, "zone_lq");
    await setPhase(this.matchId, "meeting");
  }

  // ── Subscription ────────────────────────────────────────────

  /**
   * Subscribe to meeting state changes.  Call once after joining.
   * Returns an unsubscribe function.
   */
  subscribe() {
    return onMeetingChange(this.matchId, meeting => {
      if (!meeting) { this._closeMeeting(); return; }
      this.activeMeeting = meeting;
      window._latestMeeting = meeting; // keep global in sync for tallyVotes
      this._openMeeting(meeting);
    });
  }

  // ── Meeting overlay ──────────────────────────────────────────

  _openMeeting(meeting) {
    this._hasVoted = false;
    this._ensureOverlay();

    const useChat = this.settings.useChat === "chat";
    const reason  = meeting.reason === "corpse"
      ? "🔴 A body was reported!"
      : "◈ Emergency Meeting called from zone.";

    this._overlay.querySelector("#mtr-reason").textContent  = reason;
    this._overlay.querySelector("#mtr-chat").style.display  = useChat ? "flex" : "none";
    this._overlay.querySelector("#mtr-title").textContent   = "🚨 EMERGENCY MEETING";
    this._overlay.querySelector("#mtr-result").style.display = "none";
    this._overlay.classList.add("active");

    this._buildVoteList();

    if (useChat) {
      if (this._chatUnsub) this._chatUnsub();
      this._chatUnsub = onChatMessage(this.matchId, msgs => this._renderChat(msgs));
    }

    this._startDiscussion(meeting);
  }

  _closeMeeting() {
    if (this._overlay) this._overlay.classList.remove("active");
    clearTimeout(this._discussTimer);
    clearTimeout(this._voteTimer);
    if (this._chatUnsub) { this._chatUnsub(); this._chatUnsub = null; }
  }

  // ── Discussion phase ─────────────────────────────────────────

  _startDiscussion(meeting) {
    clearTimeout(this._discussTimer);
    clearTimeout(this._voteTimer);
    const secs = this.settings.discussionTime ?? GAME_CONFIG.defaultDiscussionTimeSec;
    this._setTimerLabel("DISCUSSION");
    this._startTimer(secs, () => this._openVoting());
  }

  _openVoting() {
    this._setTimerLabel("VOTING");
    const secs = this.settings.votingTime ?? GAME_CONFIG.defaultVotingTimeSec;
    this._startTimer(secs, () => this._tallyVotes());
    // Unlock vote buttons
    this._overlay?.querySelectorAll(".mtr-vote-btn[data-id]").forEach(btn => {
      if (btn.dataset.id !== this.player.id) btn.disabled = false;
    });
  }

  // ── Vote list ────────────────────────────────────────────────

  _buildVoteList() {
    const allPlayers = this.allPlayersRef() ?? {};
    const alive = Object.entries(allPlayers).filter(([, p]) => p.alive);
    const list  = this._overlay.querySelector("#mtr-vote-list");

    list.innerHTML = alive.map(([id, p]) => `
      <button class="mtr-vote-btn" data-id="${id}"
        ${id === this.player.id ? "disabled" : ""}
        style="
          display:flex;align-items:center;gap:.7rem;
          padding:.65rem 1rem;background:var(--surface);
          border:1px solid var(--border);border-radius:var(--r);
          color:var(--text);font-family:var(--font-hud);font-size:.85rem;
          cursor:pointer;text-align:left;transition:border-color .2s;
          width:100%;margin-bottom:.4rem
        ">
        <span style="width:12px;height:12px;border-radius:50%;
                     background:${p.color};flex-shrink:0;display:inline-block"></span>
        ${p.name}${id === this.player.id ? " (you)" : ""}
      </button>
    `).join("") + `
      <button class="mtr-vote-btn" data-id="skip" style="
        display:flex;align-items:center;gap:.7rem;
        padding:.65rem 1rem;background:var(--surface);
        border:1px solid var(--border);border-radius:var(--r);
        color:var(--muted);font-family:var(--font-hud);font-size:.85rem;
        cursor:pointer;text-align:left;width:100%
      ">⊘ Skip vote</button>
    `;

    list.querySelectorAll(".mtr-vote-btn").forEach(btn => {
      if (btn.disabled) return;
      btn.addEventListener("click", async () => {
        if (this._hasVoted) return;
        this._hasVoted = true;
        list.querySelectorAll(".mtr-vote-btn").forEach(b => {
          b.disabled = true;
          b.style.opacity = "0.5";
        });
        btn.style.opacity     = "1";
        btn.style.borderColor = "var(--accent)";
        await castVote(this.matchId, this.player.id, btn.dataset.id);
      });
    });
  }

  // ── Tally ────────────────────────────────────────────────────

  async _tallyVotes() {
    // Small delay so final votes arrive
    await new Promise(r => setTimeout(r, 1400));

    const votes  = this.activeMeeting?.votes ?? {};
    const tally  = {};
    for (const v of Object.values(votes))
      tally[v] = (tally[v] ?? 0) + 1;

    const sorted   = Object.entries(tally).sort((a, b) => b[1] - a[1]);
    const topId    = sorted[0]?.[0];
    const topVotes = sorted[0]?.[1] ?? 0;
    const tied     = sorted.length > 1 && sorted[1][1] === topVotes;

    const allPlayers = this.allPlayersRef() ?? {};
    const result     = this._overlay.querySelector("#mtr-result");
    result.style.display = "block";

    if (!topId || topId === "skip" || tied) {
      result.textContent = tied
        ? "🤝 Tied vote — no one ejected."
        : "⊘ No votes — no one ejected.";
      result.style.color = "var(--muted)";
    } else {
      const ejected = allPlayers[topId];
      result.innerHTML = `
        <strong style="color:var(--danger)">${ejected?.name ?? "?"}</strong>
        was ejected (${topVotes} vote${topVotes > 1 ? "s" : ""}).<br>
        <span style="color:var(--muted);font-size:.8rem">
          They were… <strong>${ejected?.role ?? "?"}</strong>
        </span>
      `;
      await applyKill(this.matchId, topId);
    }

    setTimeout(async () => {
      await setPhase(this.matchId, "playing");
    }, 4000);
  }

  // ── Timer ─────────────────────────────────────────────────────

  _startTimer(secs, onDone) {
    let remaining = secs;
    const fill  = this._overlay?.querySelector("#mtr-timer-fill");
    const label = this._overlay?.querySelector("#mtr-timer-label");
    if (fill)  fill.style.width    = "100%";
    if (label) label.textContent   = `${secs}s`;

    const tick = () => {
      remaining--;
      if (fill)  fill.style.width   = `${(remaining / secs) * 100}%`;
      if (label) label.textContent  = `${remaining}s`;
      if (remaining <= 0) { onDone(); return; }
      this._discussTimer = setTimeout(tick, 1000);
    };
    this._discussTimer = setTimeout(tick, 1000);
  }

  _setTimerLabel(phase) {
    const label = this._overlay?.querySelector("#mtr-phase-label");
    if (label) label.textContent = phase;
    const fill = this._overlay?.querySelector("#mtr-timer-fill");
    if (fill)  fill.style.background =
      phase === "VOTING" ? "var(--danger)" : "var(--accent)";
  }

  // ── Chat ──────────────────────────────────────────────────────

  _renderChat(msgs) {
    const box = this._overlay?.querySelector("#mtr-chat-box");
    if (!box) return;
    box.innerHTML = msgs.map(m => `
      <div style="margin-bottom:.25rem;font-size:.78rem">
        <strong style="color:${m.color}">${m.playerName}:</strong>
        ${this._escHtml(m.text)}
      </div>
    `).join("");
    box.scrollTop = box.scrollHeight;
  }

  _bindChatSend() {
    const input  = this._overlay?.querySelector("#mtr-chat-input");
    const button = this._overlay?.querySelector("#mtr-chat-send");
    if (!input || !button) return;
    const send = async () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      await sendChatMessage(
        this.matchId, this.player.id,
        this.player.name, this.player.color, text
      );
    };
    button.addEventListener("click", send);
    input.addEventListener("keydown", e => { if (e.key === "Enter") send(); });
  }

  // ── Overlay DOM ───────────────────────────────────────────────

  _ensureOverlay() {
    if (this._overlay) return;

    this._overlay = document.createElement("div");
    this._overlay.id = "mgr-meeting-overlay";
    this._overlay.style.cssText = `
      position:fixed;inset:0;background:var(--bg);z-index:100;
      padding:1.5rem;display:none;flex-direction:column;
      font-family:var(--font-hud)
    `;
    this._overlay.innerHTML = `
      <h2 id="mtr-title" style="font-family:var(--font-title);color:var(--danger);
          font-size:1.2rem;margin-bottom:.3rem">🚨 EMERGENCY MEETING</h2>
      <p id="mtr-reason" style="color:var(--muted);font-size:.8rem;margin-bottom:.4rem"></p>

      <div style="height:4px;background:var(--border);border-radius:2px;
                  overflow:hidden;margin-bottom:.3rem">
        <div id="mtr-timer-fill" style="height:100%;width:100%;
             background:var(--accent);transition:width 1s linear"></div>
      </div>
      <div style="display:flex;gap:.6rem;margin-bottom:.6rem;
                  font-size:.7rem;color:var(--muted)">
        <span id="mtr-phase-label">DISCUSSION</span>
        <span id="mtr-timer-label" style="margin-left:auto"></span>
      </div>

      <div id="mtr-chat" style="display:none;flex-direction:column;gap:.35rem;
           margin-bottom:.5rem">
        <div id="mtr-chat-box" style="
          background:var(--bg);border:1px solid var(--border);border-radius:var(--r);
          padding:.75rem;height:110px;overflow-y:auto;font-size:.78rem
        "></div>
        <div style="display:flex;gap:.4rem">
          <input id="mtr-chat-input" type="text" placeholder="Say something…"
            maxlength="120" style="
              margin:0;flex:1;padding:.5rem .75rem;background:var(--bg);
              border:1px solid var(--border);border-radius:var(--r);
              color:var(--text);font-family:var(--font-hud);font-size:.82rem;outline:none
            "/>
          <button id="mtr-chat-send" style="
            padding:.4rem .75rem;background:var(--accent);color:#07080f;
            border:none;border-radius:var(--r);font-family:var(--font-title);
            font-size:.75rem;font-weight:700;cursor:pointer
          ">SEND</button>
        </div>
      </div>

      <div id="mtr-vote-list" style="
        display:flex;flex-direction:column;overflow-y:auto;flex:1
      "></div>

      <div id="mtr-result" style="
        display:none;margin-top:.6rem;padding:.9rem;background:var(--surface);
        border-radius:var(--r);border:1px solid var(--border);font-size:.85rem
      "></div>
    `;

    // Add to DOM and wire chat
    document.body.appendChild(this._overlay);
    this._bindChatSend();

    // Override display so classList.add("active") works
    const style = document.createElement("style");
    style.textContent = `#mgr-meeting-overlay.active { display: flex !important; }`;
    document.head.appendChild(style);
  }

  // ── Helpers ───────────────────────────────────────────────────

  _confirm(message) {
    return new Promise(resolve => {
      const modal = this._modalBase();
      modal.innerHTML += `
        <p style="margin-bottom:1rem;font-size:.9rem">${message}</p>
        <div style="display:flex;gap:.5rem">
          <button id="_conf-ok" style="
            flex:1;padding:.65rem;background:var(--accent);color:#07080f;
            border:none;border-radius:10px;font-family:var(--font-title);
            font-size:.8rem;font-weight:800;cursor:pointer
          ">YES</button>
          <button id="_conf-no" style="
            flex:1;padding:.65rem;background:transparent;
            border:1px solid var(--border);border-radius:10px;
            color:var(--muted);font-family:var(--font-hud);
            font-size:.8rem;cursor:pointer
          ">CANCEL</button>
        </div>
      `;
      document.body.appendChild(modal);
      modal.querySelector("#_conf-ok").onclick  = () => { document.body.removeChild(modal); resolve(true);  };
      modal.querySelector("#_conf-no").onclick  = () => { document.body.removeChild(modal); resolve(false); };
    });
  }

  /** Presents a question modal and resolves to true/false. */
  _presentQuestion(question, title = "◈ ANSWER THE QUESTION") {
    return new Promise(resolve => {
      const modal = this._modalBase();
      modal.innerHTML += `
        <h3 style="font-family:var(--font-title);color:var(--accent);
            margin-bottom:.75rem;font-size:.9rem">${title}</h3>
        <p style="margin-bottom:1rem;font-size:.88rem;line-height:1.5">
          ${question.question}
        </p>
        <input id="_pq-ans" type="text" placeholder="Your answer…" style="
          width:100%;padding:.65rem 1rem;background:var(--bg);
          border:1px solid var(--border);color:var(--text);border-radius:10px;
          font-family:var(--font-hud);font-size:.9rem;margin-bottom:.6rem;outline:none
        "/>
        <div style="display:flex;gap:.5rem">
          <button id="_pq-submit" style="
            flex:1;padding:.65rem;background:var(--accent);color:#07080f;
            border:none;border-radius:10px;font-family:var(--font-title);
            font-size:.8rem;font-weight:800;cursor:pointer
          ">SUBMIT</button>
          <button id="_pq-cancel" style="
            flex:1;padding:.65rem;background:transparent;
            border:1px solid var(--border);border-radius:10px;
            color:var(--muted);font-family:var(--font-hud);
            font-size:.8rem;cursor:pointer
          ">CANCEL</button>
        </div>
      `;
      document.body.appendChild(modal);

      const input  = modal.querySelector("#_pq-ans");
      const submit = modal.querySelector("#_pq-submit");
      const cancel = modal.querySelector("#_pq-cancel");

      const check = () => {
        const ans     = input.value.trim().toLowerCase();
        const correct = ans === question.answer.trim().toLowerCase();
        document.body.removeChild(modal);
        resolve(correct);
      };

      submit.onclick = check;
      cancel.onclick = () => { document.body.removeChild(modal); resolve(false); };
      input.addEventListener("keydown", e => { if (e.key === "Enter") check(); });
      setTimeout(() => input.focus(), 50);
    });
  }

  _modalBase() {
    const wrap = document.createElement("div");
    wrap.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.82);
      display:flex;align-items:center;justify-content:center;z-index:400;
      font-family:var(--font-hud)
    `;
    const inner = document.createElement("div");
    inner.style.cssText = `
      background:var(--surface);border:1px solid var(--border);
      border-radius:16px;padding:1.5rem;width:min(420px,95vw)
    `;
    wrap.appendChild(inner);
    // Return the inner box so callers append to it
    wrap.innerHTML = `<div style="
      background:var(--surface);border:1px solid var(--border);
      border-radius:16px;padding:1.5rem;width:min(420px,95vw)
    "></div>`;
    return wrap;
  }

  _toast(msg) {
    const el = document.createElement("div");
    el.style.cssText = `
      position:fixed;bottom:100px;left:50%;transform:translateX(-50%);
      background:var(--surface);border:1px solid var(--border);
      border-radius:999px;padding:.35rem 1rem;font-size:.75rem;
      color:var(--muted);z-index:500;pointer-events:none;
      animation:fadeIn .2s ease
    `;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => document.body.removeChild(el), 2400);
  }

  _escHtml(str) {
    return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }
}