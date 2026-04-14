// ============================================================
//  TASKS.JS — Three task minigame implementations
// ============================================================
import { fetchQuestionsForTask } from "./questions.js";
import { GAME_CONFIG } from "./config.js";

// ── Shared style helpers ──────────────────────────────────────
const S = {
  card: `background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:.85rem;margin-bottom:.6rem;font-size:.85rem;line-height:1.5`,
  btn:  `padding:.55rem .8rem;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-family:var(--font-hud);font-size:.78rem;cursor:pointer;transition:border-color .15s,color .15s`,
  meta: `font-size:.68rem;color:var(--muted);margin-bottom:.6rem`,
};

// ── TASK 1: Quick-Answer (SQ) ─────────────────────────────────
// Shows a question with 4 multiple-choice answers (1 correct + 3 from
// other fetched questions). Player taps the right answer.
export class SwipeTask {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.questions = [];
    this.currentIndex = 0;
    this.score = 0;
    this.onComplete = null;
    this._locked = false;
  }

  async init() {
    // Fetch extra so we always have decoys even for the first question
    const raw = await fetchQuestionsForTask("sq", Math.max(GAME_CONFIG.swipeCategorizeSqCount + 4, 8));
    // Shuffle and trim to desired count
    this.questions = raw.sort(() => Math.random() - 0.5).slice(0, GAME_CONFIG.swipeCategorizeSqCount);
    this._render();
  }

  _getChoices(q) {
    // Pull answers from all OTHER questions as decoys
    const pool = this.questions.filter(o => o.id !== q.id).map(o => o.answer);
    const decoys = pool.sort(() => Math.random() - 0.5).slice(0, 3);
    // If we don't have 3 decoys (very small question pool), pad with generic wrongs
    while (decoys.length < 3) decoys.push("None of the above");
    return [...decoys, q.answer].sort(() => Math.random() - 0.5);
  }

  _render() {
    const q = this.questions[this.currentIndex];
    if (!q) { this.onComplete?.(this.score, this.questions.length); return; }
    this._locked = false;
    const choices = this._getChoices(q);

    this.container.innerHTML = `
      <p style="${S.meta}">Question ${this.currentIndex + 1} / ${this.questions.length} &nbsp;·&nbsp; Score: ${this.score}</p>
      <div style="${S.card}">${q.question}</div>
      <div id="sq-choices" style="display:grid;grid-template-columns:1fr 1fr;gap:.45rem"></div>
    `;

    const grid = this.container.querySelector('#sq-choices');
    choices.forEach(choice => {
      const btn = document.createElement('button');
      btn.style.cssText = S.btn + ';text-align:left;width:100%;word-break:break-word';
      btn.textContent = choice;
      btn.addEventListener('click', () => this._handleAnswer(choice === q.answer, btn, q.answer, grid));
      grid.appendChild(btn);
    });
  }

  _handleAnswer(correct, clicked, rightAnswer, grid) {
    if (this._locked) return;
    this._locked = true;

    // Reveal correct/wrong
    grid.querySelectorAll('button').forEach(btn => {
      btn.disabled = true;
      if (btn.textContent === rightAnswer) {
        btn.style.borderColor = 'var(--accent)';
        btn.style.color = 'var(--accent)';
      }
    });
    if (!correct) {
      clicked.style.borderColor = 'var(--danger)';
      clicked.style.color = 'var(--danger)';
    }
    if (correct) this.score++;

    setTimeout(() => {
      this.currentIndex++;
      if (this.currentIndex >= this.questions.length) {
        this.onComplete?.(this.score, this.questions.length);
      } else {
        this._render();
      }
    }, 900);
  }
}

// ── TASK 2: Connector Game (LQ) ──────────────────────────────
// Two columns — questions on the left, shuffled answers on the right.
// Click a question to select it (highlighted blue), then click an answer
// to connect. Each pair locks in with a green highlight. Submit to score.
export class ConnectorTask {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.questions = [];
    this.shuffledAnswers = [];
    this.connections = {};   // questionId → answerId (the question whose answer was picked)
    this.selectedQId = null;
    this.onComplete = null;
  }

  async init() {
    const raw = await fetchQuestionsForTask("lq", GAME_CONFIG.connectorLqCount);
    this.questions = raw.sort(() => Math.random() - 0.5).slice(0, GAME_CONFIG.connectorLqCount);
    this.shuffledAnswers = [...this.questions].sort(() => Math.random() - 0.5);
    this._render();
  }

  _render() {
    this.container.innerHTML = `
      <p style="${S.meta}">Tap a question → tap its answer. Then hit Submit.</p>
      <div style="display:flex;gap:.5rem;align-items:flex-start;margin-bottom:.6rem">
        <div style="flex:1;min-width:0" id="conn-q-col"></div>
        <div style="flex:1;min-width:0" id="conn-a-col"></div>
      </div>
      <button id="conn-submit" style="width:100%;padding:.6rem;background:var(--accent);color:#07080f;
        border:none;border-radius:8px;font-family:var(--font-title);font-size:.78rem;
        font-weight:800;cursor:pointer;letter-spacing:.06em">SUBMIT</button>
    `;

    const qCol = this.container.querySelector('#conn-q-col');
    const aCol = this.container.querySelector('#conn-a-col');

    this.questions.forEach(q => {
      const btn = document.createElement('button');
      btn.dataset.qid = q.id;
      btn.style.cssText = S.btn + ';display:block;width:100%;margin-bottom:.4rem;text-align:left;word-break:break-word';
      btn.textContent = q.question.length > 70 ? q.question.slice(0, 70) + '…' : q.question;
      btn.addEventListener('click', () => this._selectQ(q.id));
      qCol.appendChild(btn);
    });

    this.shuffledAnswers.forEach(q => {
      const btn = document.createElement('button');
      btn.dataset.aid = q.id;
      btn.style.cssText = S.btn + ';display:block;width:100%;margin-bottom:.4rem;text-align:left;word-break:break-word';
      btn.textContent = q.answer.length > 70 ? q.answer.slice(0, 70) + '…' : q.answer;
      btn.addEventListener('click', () => this._selectA(q.id));
      aCol.appendChild(btn);
    });

    this.container.querySelector('#conn-submit').addEventListener('click', () => this._submit());
  }

  _selectQ(qid) {
    // Deselect all question buttons
    this.container.querySelectorAll('[data-qid]').forEach(b => {
      b.style.borderColor = this.connections[b.dataset.qid] ? 'var(--accent)' : 'var(--border)';
      b.style.color = this.connections[b.dataset.qid] ? 'var(--accent)' : 'var(--text)';
    });
    this.selectedQId = qid;
    const btn = this.container.querySelector(`[data-qid="${qid}"]`);
    if (btn) { btn.style.borderColor = 'var(--blue)'; btn.style.color = 'var(--blue)'; }
  }

  _selectA(aid) {
    if (!this.selectedQId) return;

    // Remove any existing connection that already used this answer
    for (const [prevQ, prevA] of Object.entries(this.connections)) {
      if (prevA === aid) {
        delete this.connections[prevQ];
        const qBtn = this.container.querySelector(`[data-qid="${prevQ}"]`);
        if (qBtn) { qBtn.style.borderColor = 'var(--border)'; qBtn.style.color = 'var(--text)'; }
      }
    }

    this.connections[this.selectedQId] = aid;

    // Style all question buttons to reflect current connections
    this.container.querySelectorAll('[data-qid]').forEach(b => {
      const connected = !!this.connections[b.dataset.qid];
      b.style.borderColor = b.dataset.qid === this.selectedQId ? 'var(--blue)' : connected ? 'var(--accent)' : 'var(--border)';
      b.style.color = b.dataset.qid === this.selectedQId ? 'var(--blue)' : connected ? 'var(--accent)' : 'var(--text)';
    });

    // Highlight selected answer
    this.container.querySelectorAll('[data-aid]').forEach(b => {
      const isConnected = Object.values(this.connections).includes(b.dataset.aid);
      b.style.borderColor = isConnected ? 'var(--accent)' : 'var(--border)';
      b.style.color = isConnected ? 'var(--accent)' : 'var(--text)';
    });

    this.selectedQId = null;
  }

  _submit() {
    let correct = 0;
    for (const q of this.questions) {
      // connections maps question.id → the id of the question whose answer was chosen
      // A match means they connected q to its own answer row
      if (this.connections[q.id] === q.id) correct++;
    }
    this.onComplete?.(correct, this.questions.length);
  }
}

// ── TASK 3: Bubble Tap (SQ) ───────────────────────────────────
// Question shown at the top. Three answer bubbles float up from the bottom.
// Green bubbles = correct, red = wrong. Tap the correct one to advance.
// Missing it (bubbles go off screen) counts as wrong.
export class FruitNinjaTask {
  constructor(canvasId) {
    this.canvas  = document.getElementById(canvasId);
    this.ctx     = this.canvas?.getContext("2d");
    this.questions = [];
    this.allAnswers = []; // pool for decoys
    this.currentQIndex = 0;
    this.score   = 0;
    this.items   = [];
    this.rafId   = null;
    this.phaseOver = false; // guards double-advance
    this.onComplete = null;
    this.questionLabel = '';
  }

  async init() {
    const raw = await fetchQuestionsForTask("sq", Math.max(GAME_CONFIG.fruitNinjaSqCount + 4, 12));
    const shuffled = raw.sort(() => Math.random() - 0.5);
    this.questions = shuffled.slice(0, GAME_CONFIG.fruitNinjaSqCount);
    this.allAnswers = shuffled.map(q => q.answer);
    this._spawnQuestion();
    this._attachSliceListeners();
    this._loop();
  }

  _spawnQuestion() {
    if (this.currentQIndex >= this.questions.length) return;
    this.phaseOver = false;
    const q = this.questions[this.currentQIndex];
    this.questionLabel = q.question;

    // Pick 2 unique decoys from pool (not the correct answer)
    const decoyPool = this.allAnswers.filter(a => a !== q.answer);
    const decoys = decoyPool.sort(() => Math.random() - 0.5).slice(0, 2);

    const w = this.canvas.width;
    const h = this.canvas.height;
    const count = decoys.length + 1;
    const spacing = w / (count + 1);

    const allItems = [
      { label: q.answer, isCorrect: true },
      ...decoys.map(d => ({ label: d, isCorrect: false })),
    ].sort(() => Math.random() - 0.5);

    this.items = allItems.map((item, i) => ({
      x: spacing * (i + 1),
      y: h + 50 + i * 20,
      vy: -(1.8 + Math.random() * 0.8),
      label: item.label,
      isCorrect: item.isCorrect,
      sliced: false,
      r: 38,
      alpha: 1,
    }));
  }

  _loop() {
    const { ctx, canvas } = this;
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // ── Question text ──
    this._drawWrappedText(
      this.questionLabel,
      canvas.width / 2, 22,
      canvas.width - 20,
      'rgba(200,212,240,0.95)',
      'bold 12px monospace',
    );

    // ── Progress ──
    ctx.fillStyle = 'rgba(74,85,128,0.7)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${this.currentQIndex + 1}/${this.questions.length}  ✓${this.score}`, canvas.width - 6, canvas.height - 6);
    ctx.textAlign = 'left';

    // ── Bubbles ──
    let allGone = true;
    for (const item of this.items) {
      if (item.sliced) continue;
      item.y += item.vy;
      item.vy += 0.035; // gentle gravity arc

      if (item.y < canvas.height + 60) {
        allGone = false;
        this._drawBubble(item);
      }
    }

    // All bubbles gone off screen without being tapped
    if (allGone && !this.phaseOver) {
      this.phaseOver = true;
      this._advance();
    }

    this.rafId = requestAnimationFrame(() => this._loop());
  }

  _drawBubble(item) {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = item.alpha;

    // Glow ring
    ctx.beginPath();
    ctx.arc(item.x, item.y, item.r + 4, 0, Math.PI * 2);
    ctx.fillStyle = item.isCorrect ? 'rgba(74,255,164,0.12)' : 'rgba(255,74,107,0.12)';
    ctx.fill();

    // Body
    ctx.beginPath();
    ctx.arc(item.x, item.y, item.r, 0, Math.PI * 2);
    ctx.fillStyle = item.isCorrect ? 'rgba(74,255,164,0.22)' : 'rgba(255,74,107,0.18)';
    ctx.fill();
    ctx.strokeStyle = item.isCorrect ? '#4affa4' : '#ff4a6b';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Label — wrap inside circle
    const maxW = item.r * 1.6;
    ctx.fillStyle = '#e0eaff';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const words = item.label.split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) {
        lines.push(line); line = w;
      } else { line = test; }
    }
    if (line) lines.push(line);
    const lineH = 13;
    const startY = item.y - ((lines.length - 1) * lineH) / 2;
    lines.slice(0, 4).forEach((l, i) => ctx.fillText(l, item.x, startY + i * lineH));

    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  _drawWrappedText(text, cx, startY, maxW, color, font) {
    const { ctx } = this;
    ctx.fillStyle = color;
    ctx.font = font;
    ctx.textAlign = 'center';
    const words = text.split(' ');
    let line = '', y = startY;
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, cx, y); y += 16; line = w;
      } else { line = test; }
    }
    ctx.fillText(line, cx, y);
    ctx.textAlign = 'left';
  }

  _attachSliceListeners() {
    const hit = (e) => {
      if (this.phaseOver) return;
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.canvas.width / rect.width;
      const scaleY = this.canvas.height / rect.height;
      const cx = ((e.touches?.[0]?.clientX ?? e.clientX) - rect.left) * scaleX;
      const cy = ((e.touches?.[0]?.clientY ?? e.clientY) - rect.top)  * scaleY;

      for (const item of this.items) {
        if (item.sliced) continue;
        if (Math.hypot(cx - item.x, cy - item.y) <= item.r) {
          item.sliced = true;
          if (item.isCorrect) {
            this.score++;
            // Dismiss remaining bubbles
            this.items.forEach(i => i.sliced = true);
            this.phaseOver = true;
            setTimeout(() => this._advance(), 600);
          }
          // Wrong tap: bubble pops but game continues until all gone
          break;
        }
      }
    };

    this.canvas.addEventListener('click', hit);
    this.canvas.addEventListener('touchstart', hit, { passive: true });
  }

  _advance() {
    this.currentQIndex++;
    if (this.currentQIndex >= this.questions.length) {
      this.onComplete?.(this.score, this.questions.length);
    } else {
      setTimeout(() => this._spawnQuestion(), 300);
    }
  }

  destroy() { cancelAnimationFrame(this.rafId); }
}