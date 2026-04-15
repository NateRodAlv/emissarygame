// ============================================================
//  TASKS.JS — Three task minigame implementations
// ============================================================
import { fetchQuestionsForTask } from "./questions.js";
import { GAME_CONFIG } from "./config.js";

// ─────────────────────────────────────────────────────────────
// TASK 1: Swipe to Categorize (SQ)
// ─────────────────────────────────────────────────────────────
export class SwipeTask {
  constructor(containerId, category = null) {
    this.container    = document.getElementById(containerId);
    this.category     = category;
    this.questions    = [];
    this.currentIndex = 0;
    this.score        = 0;
    this.onComplete   = null;
    this._catA        = "False";
    this._catB        = "True";
    this._animating   = false;
  }

  async init() {
    this.questions = await fetchQuestionsForTask("sq", GAME_CONFIG.swipeCategorizeSqCount, this.category);
    const cats = [...new Set(this.questions.map(q => q.category).filter(Boolean))];
    if (cats.length >= 2)      { this._catA = cats[0]; this._catB = cats[1]; }
    else if (cats.length === 1){ this._catA = cats[0]; this._catB = "Other"; }
    this._renderCard();
  }

  _renderCard() {
    if (this.currentIndex >= this.questions.length) {
      this.onComplete?.(this.score, this.questions.length);
      return;
    }
    const q   = this.questions[this.currentIndex];
    const pct = Math.round((this.currentIndex / this.questions.length) * 100);
    this.container.innerHTML = `
      <div style="margin-bottom:.6rem">
        <div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:var(--accent);transition:width .3s"></div>
        </div>
        <p style="font-size:.7rem;color:var(--muted);text-align:right;margin-top:.25rem">
          ${this.currentIndex + 1} / ${this.questions.length} &nbsp;✓ ${this.score}
        </p>
      </div>
      <div style="position:relative;height:148px;overflow:hidden;margin-bottom:.7rem">
        <div id="swipe-card" tabindex="0" style="
          position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
          background:var(--bg);border:2px solid var(--border);border-radius:14px;
          padding:1rem 1.2rem;text-align:center;font-size:.9rem;line-height:1.5;
          cursor:grab;user-select:none;touch-action:none;will-change:transform;outline:none
        ">${q.question}</div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:.78rem;font-weight:700;padding:0 .3rem;margin-bottom:.35rem">
        <span style="color:var(--danger)">⬅ ${this._catA}</span>
        <span style="color:var(--accent)">${this._catB} ➡</span>
      </div>
      <p style="text-align:center;font-size:.67rem;color:var(--muted)">Swipe or drag the card • Arrow keys also work</p>
    `;
    this._attachCardListeners();
  }

  _attachCardListeners() {
    const card = this.container.querySelector("#swipe-card");
    if (!card) return;
    let startX = 0, dragging = false;
    const begin = x => { startX = x; dragging = true; card.style.transition = "none"; };
    const move  = x => {
      if (!dragging || this._animating) return;
      const dx = x - startX, rot = dx * 0.07;
      card.style.transform   = `translateX(${dx}px) rotate(${rot}deg)`;
      card.style.borderColor = dx < -25 ? "var(--danger)" : dx > 25 ? "var(--accent)" : "var(--border)";
    };
    const end = x => {
      if (!dragging) return; dragging = false;
      const dx = x - startX;
      if (Math.abs(dx) > 65) this._flyOut(dx < 0 ? "left" : "right");
      else { card.style.transition = "transform .25s, border-color .2s"; card.style.transform = ""; card.style.borderColor = ""; }
    };
    card.addEventListener("mousedown",   e => begin(e.clientX));
    window.addEventListener("mousemove", e => { if (dragging) move(e.clientX); });
    window.addEventListener("mouseup",   e => { if (dragging) end(e.clientX); });
    card.addEventListener("touchstart",  e => begin(e.touches[0].clientX), { passive: true });
    card.addEventListener("touchmove",   e => { e.preventDefault(); move(e.touches[0].clientX); }, { passive: false });
    card.addEventListener("touchend",    e => end(e.changedTouches[0].clientX));
    card.addEventListener("keydown", e => {
      if (e.key === "ArrowLeft")  { e.preventDefault(); this._flyOut("left");  }
      if (e.key === "ArrowRight") { e.preventDefault(); this._flyOut("right"); }
    });
  }

  _flyOut(direction) {
    if (this._animating) return;
    this._animating = true;
    const card = this.container.querySelector("#swipe-card");
    if (!card) return;
    const tx = direction === "left" ? -520 : 520, rot = direction === "left" ? -22 : 22;
    card.style.transition = "transform .28s ease-in, opacity .28s";
    card.style.transform  = `translateX(${tx}px) rotate(${rot}deg)`;
    card.style.opacity    = "0";
    setTimeout(() => { this._animating = false; this._handleAnswer(direction); }, 300);
  }

  _handleAnswer(direction) {
    const q = this.questions[this.currentIndex];
    let correct;
    if (q.correctDirection)   correct = direction === q.correctDirection;
    else if (q.category)      correct = direction === (q.category === this._catA ? "left" : "right");
    else                      correct = direction === "right";
    if (correct) this.score++;
    this.currentIndex++;
    setTimeout(() => this._renderCard(), 40);
  }
}


// ─────────────────────────────────────────────────────────────
// TASK 2: Connector Game (LQ)
// ─────────────────────────────────────────────────────────────
export class ConnectorTask {
  constructor(containerId, category = null) {
    this.container    = document.getElementById(containerId);
    this.category     = category;
    this.questions    = [];
    this.connections  = {};
    this.selectedQ    = null;
    this._answerOrder = [];
    this.onComplete   = null;
  }

  async init() {
    this.questions    = await fetchQuestionsForTask("lq", GAME_CONFIG.connectorLqCount, this.category);
    this._answerOrder = [...this.questions].sort(() => Math.random() - 0.5).map(q => q.id);
    this._render();
  }

  _trunc(str, n) { return str && str.length > n ? str.slice(0, n) + "…" : (str ?? ""); }

  _render() {
    if (!this.questions.length) {
      this.container.innerHTML = `<p style="color:var(--muted);text-align:center">No questions available.</p>`;
      return;
    }
    const byId = Object.fromEntries(this.questions.map(q => [q.id, q]));
    this.container.innerHTML = `
      <p style="font-size:.7rem;color:var(--muted);margin-bottom:.5rem">Click a question then its answer to connect them.</p>
      <div id="conn-wrap" style="display:grid;grid-template-columns:1fr 30px 1fr;align-items:start;position:relative">
        <div id="conn-left" style="display:flex;flex-direction:column;gap:.35rem">
          ${this.questions.map(q => `
            <div class="cn q-node" data-qid="${q.id}" style="padding:.42rem .55rem;border-radius:8px;border:1px solid var(--border);background:var(--bg);font-size:.73rem;line-height:1.35;cursor:pointer;transition:border-color .15s,background .15s">${this._trunc(q.question, 55)}</div>
          `).join("")}
        </div>
        <svg id="conn-svg" style="overflow:visible;width:30px;pointer-events:none;min-height:${this.questions.length * 44}px;align-self:stretch;position:relative;z-index:2"></svg>
        <div id="conn-right" style="display:flex;flex-direction:column;gap:.35rem">
          ${this._answerOrder.map(aid => `
            <div class="cn a-node" data-aid="${aid}" style="padding:.42rem .55rem;border-radius:8px;border:1px solid var(--border);background:var(--bg);font-size:.73rem;line-height:1.35;cursor:pointer;transition:border-color .15s,background .15s">${this._trunc(byId[aid].answer, 55)}</div>
          `).join("")}
        </div>
      </div>
      <button id="conn-submit" style="margin-top:.8rem;width:100%;padding:.6rem;border:none;border-radius:8px;background:var(--accent);color:#07080f;font-family:var(--font-hud);font-size:.8rem;font-weight:700;cursor:pointer;letter-spacing:.05em">SUBMIT CONNECTIONS</button>
    `;
    this._bindEvents();
  }

  _style(el, connected, selected = false) {
    if (!el) return;
    if (selected)       { el.style.borderColor = "var(--accent)"; el.style.background = "rgba(74,255,164,0.08)"; }
    else if (connected) { el.style.borderColor = "#4a9eff";       el.style.background = "rgba(74,158,255,0.07)"; }
    else                { el.style.borderColor = "var(--border)"; el.style.background = "var(--bg)"; }
  }

  _bindEvents() {
    this.container.addEventListener("click", e => {
      const qEl = e.target.closest("[data-qid]"), aEl = e.target.closest("[data-aid]");
      if (qEl) {
        this.container.querySelectorAll("[data-qid]").forEach(n => this._style(n, !!this.connections[n.dataset.qid]));
        this.selectedQ = qEl.dataset.qid;
        this._style(qEl, false, true);
        return;
      }
      if (aEl && this.selectedQ) {
        const newAid = aEl.dataset.aid, oldAid = this.connections[this.selectedQ];
        if (oldAid) this._style(this.container.querySelector(`[data-aid="${oldAid}"]`), false);
        for (const [qid, aid] of Object.entries(this.connections)) {
          if (aid === newAid && qid !== this.selectedQ) { delete this.connections[qid]; this._style(this.container.querySelector(`[data-qid="${qid}"]`), false); }
        }
        this.connections[this.selectedQ] = newAid;
        this._style(this.container.querySelector(`[data-qid="${this.selectedQ}"]`), true);
        this._style(aEl, true);
        this.selectedQ = null;
        this._drawLines();
      }
    });
    this.container.querySelector("#conn-submit").addEventListener("click", () => this._submit());
  }

  _drawLines() {
    const svg = this.container.querySelector("#conn-svg");
    if (!svg) return;
    svg.innerHTML = "";
    const svgRect = svg.getBoundingClientRect();
    for (const [qid, aid] of Object.entries(this.connections)) {
      const qEl = this.container.querySelector(`[data-qid="${qid}"]`), aEl = this.container.querySelector(`[data-aid="${aid}"]`);
      if (!qEl || !aEl) continue;
      const qR = qEl.getBoundingClientRect(), aR = aEl.getBoundingClientRect();
      const y1 = qR.top + qR.height / 2 - svgRect.top, y2 = aR.top + aR.height / 2 - svgRect.top;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M 0 ${y1} C 15 ${y1}, 15 ${y2}, 30 ${y2}`);
      path.setAttribute("stroke", "#4a9eff"); path.setAttribute("stroke-width", "2");
      path.setAttribute("fill", "none"); path.setAttribute("stroke-linecap", "round");
      svg.appendChild(path);
    }
  }

  _submit() {
    let correct = 0;
    for (const q of this.questions) { if (this.connections[q.id] === q.id) correct++; }
    this.onComplete?.(correct, this.questions.length);
  }
}


// ─────────────────────────────────────────────────────────────
// TASK 3: Fruit Ninja (SQ)
// ─────────────────────────────────────────────────────────────
export class FruitNinjaTask {
  constructor(canvasId, category = null) {
    this.canvas     = document.getElementById(canvasId);
    this.ctx        = this.canvas?.getContext("2d");
    this.category   = category;
    this.questions  = [];
    this.score      = 0;
    this.onComplete = null;
    this.rafId      = null;
    this._done      = false;
    this._waveIdx   = 0;
    this._items     = [];
    this._waveDone  = false;
    this._flash     = null;
  }

  async init() {
    this.questions = await fetchQuestionsForTask("sq", GAME_CONFIG.fruitNinjaSqCount, this.category);
    this._spawnWave(0);
    this._attachSliceListeners();
    this._loop();
  }

  _spawnWave(idx) {
    if (idx >= this.questions.length) { this._done = true; setTimeout(() => this.onComplete?.(this.score, this.questions.length), 500); return; }
    this._waveDone = false; this._waveIdx = idx;
    const q = this.questions[idx];
    const decoys = this.questions.filter((_, i) => i !== idx);
    const decoy  = decoys.length ? decoys[Math.floor(Math.random() * decoys.length)] : { answer: "—" };
    const W = this.canvas.width, H = this.canvas.height;
    const flip = Math.random() < 0.5;
    const left  = flip ? { label: q.answer, isCorrect: true  } : { label: decoy.answer, isCorrect: false };
    const right = flip ? { label: decoy.answer, isCorrect: false } : { label: q.answer, isCorrect: true  };
    this._items = [
      { ...left,  x: W * 0.28 + (Math.random() - 0.5) * 20, y: H + 15, vy: -(3.4 + Math.random() * 0.4), vx:  0.3, r: 34, sliced: false, alpha: 1 },
      { ...right, x: W * 0.72 + (Math.random() - 0.5) * 20, y: H + 15, vy: -(3.2 + Math.random() * 0.4), vx: -0.3, r: 34, sliced: false, alpha: 1 },
    ];
  }

  _loop() {
    if (this._done) return;
    const { ctx } = this;
    const W = this.canvas.width, H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (this._flash) { ctx.fillStyle = this._flash.correct ? "rgba(74,255,164,0.12)" : "rgba(255,74,107,0.12)"; ctx.fillRect(0, 0, W, H); if (--this._flash.timer <= 0) this._flash = null; }
    const q = this.questions[this._waveIdx];
    if (q) {
      ctx.fillStyle = "rgba(200,212,240,0.92)"; ctx.font = "bold 12px 'Share Tech Mono',monospace"; ctx.textAlign = "center";
      ctx.shadowColor = "rgba(74,255,164,0.4)"; ctx.shadowBlur = 6;
      ctx.fillText(q.question.length > 46 ? q.question.slice(0, 46) + "…" : q.question, W / 2, 20);
      ctx.shadowBlur = 0;
    }
    ctx.fillStyle = "rgba(74,85,128,0.9)"; ctx.font = "11px monospace"; ctx.textAlign = "left";
    ctx.fillText(`✓ ${this.score}/${this.questions.length}`, 8, H - 8);
    ctx.fillStyle = "rgba(74,85,128,0.65)"; ctx.font = "10px monospace"; ctx.textAlign = "right";
    ctx.fillText("Tap the correct answer", W - 8, H - 8); ctx.textAlign = "left";
    let allOffScreen = true, correctSliced = false;
    for (const item of this._items) {
      if (!item.sliced) { item.x += item.vx; item.y += item.vy; item.vy += 0.045; if (item.y < H + 80) allOffScreen = false; }
      else if (item.isCorrect) correctSliced = true;
      this._drawBubble(item, H);
    }
    if ((correctSliced || allOffScreen) && !this._waveDone) { this._waveDone = true; setTimeout(() => this._spawnWave(this._waveIdx + 1), 550); }
    this.rafId = requestAnimationFrame(() => this._loop());
  }

  _drawBubble(item, H) {
    const { ctx } = this;
    if (item.sliced) {
      item.alpha = Math.max(0, item.alpha - 0.055); if (item.alpha <= 0) return;
      ctx.globalAlpha = item.alpha;
      const c = item.isCorrect ? "#4affa4" : "#ff4a6b";
      ctx.fillStyle = item.isCorrect ? "rgba(74,255,164,0.35)" : "rgba(255,74,107,0.28)";
      ctx.beginPath(); ctx.ellipse(item.x - 10, item.y - 5, item.r * 0.7, item.r * 0.35, -0.35, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(item.x + 10, item.y + 5, item.r * 0.7, item.r * 0.35,  0.35, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = c; ctx.font = "bold 16px monospace"; ctx.textAlign = "center";
      ctx.fillText(item.isCorrect ? "✓" : "✗", item.x, item.y - item.r - 4); ctx.textAlign = "left"; ctx.globalAlpha = 1;
      return;
    }
    if (item.y > H + 70) return;
    const c  = item.isCorrect ? "#4affa4" : "#ff4a6b";
    const bg = item.isCorrect ? "rgba(74,255,164,0.11)" : "rgba(255,74,107,0.11)";
    ctx.shadowColor = c; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.arc(item.x, item.y, item.r, 0, Math.PI * 2); ctx.fillStyle = bg; ctx.fill(); ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.stroke(); ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.ellipse(item.x - item.r * 0.3, item.y - item.r * 0.38, item.r * 0.28, item.r * 0.16, -0.6, 0, Math.PI * 2); ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.fill();
    ctx.fillStyle = c; ctx.font = "bold 11px monospace"; ctx.textAlign = "center";
    ctx.fillText(item.label?.length > 13 ? item.label.slice(0, 13) + "…" : (item.label ?? ""), item.x, item.y + 4); ctx.textAlign = "left";
  }

  _attachSliceListeners() {
    const tryHit = (cx, cy) => {
      if (this._done || this._waveDone) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = (cx - rect.left) * (this.canvas.width / rect.width);
      const y = (cy - rect.top)  * (this.canvas.height / rect.height);
      for (const item of this._items) {
        if (item.sliced || item.y > this.canvas.height + 70) continue;
        if (Math.hypot(x - item.x, y - item.y) <= item.r) { item.sliced = true; item.alpha = 1; this._flash = { correct: item.isCorrect, timer: 22 }; if (item.isCorrect) this.score++; break; }
      }
    };
    this.canvas.addEventListener("mousedown",  e => tryHit(e.clientX, e.clientY));
    this.canvas.addEventListener("touchstart", e => { e.preventDefault(); tryHit(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
  }

  destroy() { cancelAnimationFrame(this.rafId); this._done = true; }
}