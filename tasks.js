// ============================================================
//  TASKS.JS — Three task minigame skeletons
// ============================================================
import { fetchQuestionsForTask } from "./questions.js";
import { GAME_CONFIG } from "./config.js";

// ── TASK 1: Swipe to Categorize (SQ) ─────────────────────────
// Player sees a word/phrase and swipes left or right to assign category
export class SwipeTask {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.questions = [];
    this.currentIndex = 0;
    this.score = 0;
    this.onComplete = null; // callback(score, total)
  }

  async init() {
    this.questions = await fetchQuestionsForTask("sq", GAME_CONFIG.swipeCategorizeSqCount);
    this.render();
    this.attachSwipeListeners();
  }

  render() {
    // TODO: build card UI
    // Card shows: this.questions[this.currentIndex].question
    // Left label = category A, Right label = category B
    // (categories must be encoded in your question table — add a `categoryA`/`categoryB` column)
    this.container.innerHTML = `
      <div class="swipe-card" id="swipe-card">
        <p class="swipe-question">${this.questions[this.currentIndex]?.question ?? ""}</p>
        <div class="swipe-labels">
          <span class="label-left">⬅ Category A</span>
          <span class="label-right">Category B ➡</span>
        </div>
      </div>
    `;
  }

  attachSwipeListeners() {
    // TODO: pointer/touch drag logic — detect left or right swipe
    // On swipe: call this.handleSwipe("left"|"right")
  }

  handleSwipe(direction) {
    const q = this.questions[this.currentIndex];
    const correct = direction === q.correctDirection; // ⚠️ add `correctDirection` col to Supabase SQ table
    if (correct) this.score++;
    this.currentIndex++;
    if (this.currentIndex >= this.questions.length) {
      this.onComplete?.(this.score, this.questions.length);
    } else {
      this.render();
    }
  }
}

// ── TASK 2: Connector Game (LQ) ──────────────────────────────
// Player draws lines connecting questions to their correct answers
export class ConnectorTask {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.questions = [];
    this.connections = {}; // { questionId: answerId }
    this.onComplete = null;
  }

  async init() {
    this.questions = await fetchQuestionsForTask("lq", GAME_CONFIG.connectorLqCount);
    this.render();
    this.attachDragListeners();
  }

  render() {
    // TODO: render two columns
    // Left column: shuffled questions (each a draggable node)
    // Right column: shuffled answers (each a drop target)
    // Draw SVG lines between connected pairs
    this.container.innerHTML = `
      <div class="connector-wrap">
        <div class="connector-left" id="conn-questions">
          <!-- question nodes -->
        </div>
        <svg class="connector-lines" id="conn-svg"></svg>
        <div class="connector-right" id="conn-answers">
          <!-- answer nodes -->
        </div>
        <button id="conn-submit">Submit</button>
      </div>
    `;
    // TODO: populate nodes from this.questions
  }

  attachDragListeners() {
    // TODO: pointer drag from question node → answer node
    // On connect: record in this.connections
  }

  score() {
    let correct = 0;
    for (const q of this.questions) {
      if (this.connections[q.id] === q.answer) correct++;
    }
    return correct;
  }

  submit() {
    this.onComplete?.(this.score(), this.questions.length);
  }
}

// ── TASK 3: Fruit Ninja (SQ) ─────────────────────────────────
// Correct-answer "fruit" flies up; wrong answers are "bombs".
// Player taps/slices correct ones.
export class FruitNinjaTask {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas?.getContext("2d");
    this.questions = [];
    this.items = [];    // { x, y, vy, label, isCorrect, sliced }
    this.score = 0;
    this.sliced = 0;
    this.onComplete = null;
    this.rafId = null;
  }

  async init() {
    this.questions = await fetchQuestionsForTask("sq", GAME_CONFIG.fruitNinjaSqCount);
    this.spawnItems();
    this.attachSliceListeners();
    this.loop();
  }

  spawnItems() {
    // For each question, create one correct answer item + 1-2 decoy items
    // TODO: build item list from this.questions
    // each item: { x: random, y: canvas.height + random offset, vy: -speed, label, isCorrect }
  }

  loop() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const item of this.items) {
      if (item.sliced) continue;
      item.y += item.vy;
      // TODO: draw item (circle + label text)
      // TODO: remove items that go off screen
    }
    if (this.sliced < this.questions.length) {
      this.rafId = requestAnimationFrame(() => this.loop());
    } else {
      this.onComplete?.(this.score, this.questions.length);
    }
  }

  attachSliceListeners() {
    // TODO: pointerdown / touch → check hit on item
    // If hit correct item: score++, item.sliced = true, sliced++
    // If hit wrong item: penalty? (designer decision)
  }

  destroy() {
    cancelAnimationFrame(this.rafId);
  }
}
