// ============================================================
//  world.js — Canvas game engine
// ============================================================
import { movePlayer, onPlayersChange } from "./realtime.js";

// ── Cosmetic color palette (no role info) ─────────────────────
export const PLAYER_COLORS = [
  "#ff4a6b","#4a9eff","#4affa4","#ffc94a",
  "#c44aff","#ff8c4a","#4affed","#ff4ae8",
  "#a0ff4a","#ffffff",
];
export function randomColor() {
  return PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];
}

// ── Map ───────────────────────────────────────────────────────
// R = player collision radius. Corridors must start R px INSIDE
// each room they connect, so walkable zones overlap.
const R     = 10;
const SPEED = 3;
const KILL_RANGE = 50; // px

export const MAP = {
  width:  1200,
  height: 700,
  rooms: [
    { id:"cafeteria",  label:"Cafeteria",   x:420, y: 20, w:360, h:220, color:"#1a2a3a", taskZone:false, meetingZone:true  },
    { id:"weapons",    label:"Weapons",     x: 20, y: 20, w:260, h:180, color:"#1a2030", taskZone:true,  meetingZone:false },
    { id:"nav",        label:"Navigation",  x:860, y: 20, w:260, h:180, color:"#1a2030", taskZone:true,  meetingZone:false },
    { id:"shields",    label:"Shields",     x:860, y:360, w:260, h:180, color:"#1a2030", taskZone:true,  meetingZone:false },
    { id:"o2",         label:"O2",          x:420, y:460, w:180, h:160, color:"#1a2030", taskZone:true,  meetingZone:false },
    { id:"reactor",    label:"Reactor",     x: 20, y:360, w:260, h:180, color:"#2a1a1a", taskZone:true,  meetingZone:false },
    { id:"security",   label:"Security",    x:220, y:260, w:160, h:140, color:"#1a1a2a", taskZone:true,  meetingZone:false },
    { id:"medbay",     label:"MedBay",      x:620, y:460, w:180, h:160, color:"#1a2a1a", taskZone:true,  meetingZone:false },
    { id:"electrical", label:"Electrical",  x:620, y:260, w:160, h:160, color:"#2a2a1a", taskZone:true,  meetingZone:false },
    { id:"storage",    label:"Storage",     x:420, y:260, w:160, h:160, color:"#1e1e2e", taskZone:false, meetingZone:false },
    { id:"admin",      label:"Admin",       x:820, y:260, w:160, h:160, color:"#1a2a2a", taskZone:true,  meetingZone:false },
  ],
  // Each corridor overlaps the rooms it connects by R px on each end,
  // so the walkable zones are contiguous and players can actually pass through.
  corridors: [
    // weapons(right=280) ↔ cafeteria(left=420): x must reach 280-R=270 and 420+R=430
    { x:270, y: 80, w:160, h: 60 },
    // cafeteria(right=780) ↔ nav(left=860)
    { x:770, y: 70, w:100, h: 60 },
    // cafeteria(bottom=240) ↔ storage(top=260)
    { x:480, y:230, w: 80, h: 40 },
    // weapons(bottom=200) ↔ reactor(top=360): long vertical left side
    { x: 60, y:190, w: 60, h:180 },
    // weapons(bottom=200) ↔ security(top=260): right column of weapons
    { x:220, y:190, w: 60, h: 80 },
    // security(right=380) ↔ storage(left=420)
    { x:370, y:280, w: 60, h: 80 },
    // storage(right=580) ↔ electrical(left=620)
    { x:570, y:290, w: 60, h: 80 },
    // electrical(right=780) ↔ admin(left=820)
    { x:770, y:290, w: 60, h: 80 },
    // nav(bottom=200) ↔ shields(top=360)
    { x:920, y:190, w: 60, h:180 },
    // admin(bottom=420) ↔ shields(top=360): they share x=860-980
    { x:880, y:350, w: 80, h: 80 },
    // storage(bottom=420) ↔ o2(top=460)
    { x:460, y:410, w: 80, h: 60 },
    // o2(right=600) ↔ medbay(left=620)
    { x:590, y:490, w: 40, h: 80 },
    // reactor(top=360) ↔ security(bottom=400)
    { x:220, y:350, w: 60, h: 60 },
    // electrical(bottom=420) ↔ medbay(top=460)
    { x:660, y:410, w: 80, h: 60 },
    // reactor(right=280) ↔ o2(left=420): lower horizontal
    { x:270, y:480, w:160, h: 60 },
  ],
};

// ── Collision ─────────────────────────────────────────────────
const WALKABLE = [...MAP.rooms, ...MAP.corridors];

function inRect(x, y, rect) {
  return x >= rect.x + R && x <= rect.x + rect.w - R &&
         y >= rect.y + R && y <= rect.y + rect.h - R;
}
function canMoveTo(x, y) { return WALKABLE.some(r => inRect(x, y, r)); }
function currentRoom(x, y) { return MAP.rooms.find(r => inRect(x, y, r)) ?? null; }

// ── World ─────────────────────────────────────────────────────
export class World {
  constructor(canvas, matchId, localPlayer) {
    this.canvas   = canvas;
    this.ctx      = canvas.getContext("2d");
    this.matchId  = matchId;
    this.local    = localPlayer;  // { id, name, role, color }
    this.players  = {};
    this.keys     = {};
    this.joyVec   = null;
    this.camera   = { x:0, y:0 };
    this.rafId    = null;
    this.syncTick = 0;
    this.lastRoom = null;
    this.onEnterRoom = null;

    // Spawn in cafeteria centre
    this.lx = 600; this.ly = 130;
  }

  start() {
    this._resizeCanvas();
    this._attachInput();
    this._subscribeToPlayers();
    this._loop();
  }

  stop() {
    cancelAnimationFrame(this.rafId);
    document.removeEventListener("keydown", this._onKeyDown);
    document.removeEventListener("keyup",   this._onKeyUp);
  }

  _resizeCanvas() {
    this.canvas.width  = this.canvas.offsetWidth  || 800;
    this.canvas.height = this.canvas.offsetHeight || 450;
  }

  // ── Input ─────────────────────────────────────────────────
  _attachInput() {
    this._onKeyDown = (e) => {
      this.keys[e.key] = true;
      // Only prevent default for game keys, not Tab/F5 etc.
      if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight",
           "w","a","s","d","W","A","S","D"].includes(e.key)) e.preventDefault();
    };
    this._onKeyUp = (e) => { this.keys[e.key] = false; };
    document.addEventListener("keydown", this._onKeyDown);
    document.addEventListener("keyup",   this._onKeyUp);
    this._attachJoystick();
  }

  _attachJoystick() {
    const joy  = document.getElementById("joystick");
    const knob = document.getElementById("joystick-knob");
    if (!joy) return;
    const MAX = 40;
    let origin = null;

    joy.addEventListener("touchstart", (e) => {
      const t = e.touches[0];
      origin = { x: t.clientX, y: t.clientY };
    }, { passive: true });

    joy.addEventListener("touchmove", (e) => {
      if (!origin) return;
      let dx = e.touches[0].clientX - origin.x;
      let dy = e.touches[0].clientY - origin.y;
      const d = Math.hypot(dx, dy);
      if (d > MAX) { dx = dx/d*MAX; dy = dy/d*MAX; }
      knob.style.transform = `translate(${dx}px,${dy}px)`;
      this.joyVec = { x: dx/MAX, y: dy/MAX };
    }, { passive: true });

    joy.addEventListener("touchend", () => {
      origin = null; this.joyVec = null;
      knob.style.transform = "translate(0,0)";
    });
  }

  // ── Firebase ──────────────────────────────────────────────
  _subscribeToPlayers() {
    onPlayersChange(this.matchId, (snap) => { this.players = snap ?? {}; });
  }

  _syncPosition() {
    movePlayer(this.matchId, this.local.id, Math.round(this.lx), Math.round(this.ly));
  }

  // ── Loop ──────────────────────────────────────────────────
  _loop() {
    this._update();
    this._render();
    this.rafId = requestAnimationFrame(() => this._loop());
  }

  _update() {
    let dx = 0, dy = 0;
    if (this.keys["ArrowLeft"]  || this.keys["a"] || this.keys["A"]) dx -= SPEED;
    if (this.keys["ArrowRight"] || this.keys["d"] || this.keys["D"]) dx += SPEED;
    if (this.keys["ArrowUp"]    || this.keys["w"] || this.keys["W"]) dy -= SPEED;
    if (this.keys["ArrowDown"]  || this.keys["s"] || this.keys["S"]) dy += SPEED;
    if (this.joyVec) { dx += this.joyVec.x * SPEED; dy += this.joyVec.y * SPEED; }
    if (dx && dy) { dx *= 0.707; dy *= 0.707; }

    const nx = this.lx + dx, ny = this.ly + dy;
    if      (canMoveTo(nx, ny))      { this.lx = nx; this.ly = ny; }
    else if (canMoveTo(nx, this.ly)) { this.lx = nx; }
    else if (canMoveTo(this.lx, ny)) { this.ly = ny; }

    // Camera
    const cw = this.canvas.width, ch = this.canvas.height;
    this.camera.x = Math.max(0, Math.min(this.lx - cw/2, MAP.width  - cw));
    this.camera.y = Math.max(0, Math.min(this.ly - ch/2, MAP.height - ch));

    // Room events
    const room = currentRoom(this.lx, this.ly);
    if (room?.id !== this.lastRoom?.id) {
      this.lastRoom = room;
      this.onEnterRoom?.(room);
    }

    // Sync position to Firebase every 6 frames if moving
    this.syncTick++;
    if (this.syncTick >= 6 && (dx || dy)) { this.syncTick = 0; this._syncPosition(); }
  }

  // ── Render ────────────────────────────────────────────────
  _render() {
    const { ctx, camera } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.translate(-camera.x, -camera.y);
    this._drawBackground();
    this._drawCorridors();
    this._drawRooms();
    this._drawRoomLabels();
    this._drawOtherPlayers();
    this._drawLocalPlayer();
    ctx.restore();
    this._drawMinimap();
  }

  _drawBackground() {
    const { ctx } = this;
    ctx.fillStyle = "#07080f";
    ctx.fillRect(0, 0, MAP.width, MAP.height);
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    for (let i = 0; i < 220; i++)
      ctx.fillRect((i*137+41)%MAP.width, (i*97+83)%MAP.height, 1, 1);
  }

  _drawCorridors() {
    const { ctx } = this;
    for (const c of MAP.corridors) {
      ctx.fillStyle = "#0f1520";
      ctx.fillRect(c.x, c.y, c.w, c.h);
      ctx.strokeStyle = "#1a2540"; ctx.lineWidth = 1;
      ctx.strokeRect(c.x, c.y, c.w, c.h);
    }
  }

  _drawRooms() {
    const { ctx } = this;
    for (const r of MAP.rooms) {
      ctx.fillStyle = r.color;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = r.meetingZone ? "#4affa4" : r.taskZone ? "#4a6aff" : "#1e2a40";
      ctx.lineWidth = (r.meetingZone || r.taskZone) ? 2 : 1;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      if (r.meetingZone) {
        ctx.fillStyle = "rgba(74,255,164,0.06)";
        ctx.fillRect(r.x, r.y, r.w, r.h);
        const a = 0.4 + 0.3 * Math.sin(Date.now()/800);
        ctx.fillStyle = `rgba(74,255,164,${a})`;
        ctx.font = "16px monospace"; ctx.textAlign = "center";
        ctx.fillText("⚑", r.x + r.w/2, r.y + 22);
      }
      if (r.taskZone && !r.meetingZone) {
        ctx.fillStyle = "rgba(74,106,255,0.5)";
        ctx.font = "13px monospace"; ctx.textAlign = "right";
        ctx.fillText("✦", r.x + r.w - 8, r.y + 18);
      }
    }
    ctx.textAlign = "left";
  }

  _drawRoomLabels() {
    const { ctx } = this;
    ctx.font = "bold 11px 'Courier New',monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(180,200,255,0.45)";
    for (const r of MAP.rooms)
      ctx.fillText(r.label.toUpperCase(), r.x + r.w/2, r.y + r.h/2 + 4);
    ctx.textAlign = "left";
  }

  _drawOtherPlayers() {
    for (const [id, p] of Object.entries(this.players)) {
      if (id === this.local.id) continue;
      this._drawPlayer(p.x ?? 600, p.y ?? 130, p.name, p.color ?? "#aaa", !p.alive);
    }
  }

  _drawLocalPlayer() {
    this._drawPlayer(this.lx, this.ly, this.local.name, this.local.color ?? "#fff", false, true);
  }

  _drawPlayer(x, y, name, color, dead, isLocal = false) {
    const { ctx } = this;
    const c = dead ? "#333" : color;

    // Shadow
    ctx.beginPath();
    ctx.ellipse(x, y + R - 1, R*0.8, R*0.28, 0, 0, Math.PI*2);
    ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fill();

    // Body
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI*2);
    ctx.fillStyle = dead ? "#222228" : c; ctx.fill();
    if (isLocal) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke(); }

    // Visor
    ctx.beginPath();
    ctx.ellipse(x+3, y-3, R*0.45, R*0.3, -0.4, 0, Math.PI*2);
    ctx.fillStyle = dead ? "#1a1a22" : "rgba(160,220,255,0.9)"; ctx.fill();

    // Backpack
    const dark = this._darken(c, 0.55);
    ctx.fillStyle = dead ? "#1a1a22" : dark;
    ctx.fillRect(x + R - 3, y - 4, 5, 10);

    // Ghost tint when dead
    if (dead) {
      ctx.globalAlpha = 0.3;
      ctx.beginPath(); ctx.arc(x, y, R+5, 0, Math.PI*2);
      ctx.fillStyle = "#8888ff"; ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Kill range indicator for impostor (local only, pulsing ring)
    if (isLocal && this.local.role === "impostor") {
      const pulse = 0.08 + 0.06 * Math.sin(Date.now()/300);
      ctx.beginPath(); ctx.arc(x, y, KILL_RANGE, 0, Math.PI*2);
      ctx.strokeStyle = `rgba(255,74,107,${pulse})`; ctx.lineWidth = 1; ctx.stroke();
    }

    // Name
    ctx.font = isLocal ? "bold 10px monospace" : "10px monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = isLocal ? "#fff" : "rgba(200,210,240,0.8)";
    ctx.fillText(name, x, y - R - 5);
    ctx.textAlign = "left";
  }

  _darken(hex, f) {
    try {
      const n = parseInt(hex.slice(1), 16);
      return `rgb(${Math.floor(((n>>16)&255)*f)},${Math.floor(((n>>8)&255)*f)},${Math.floor((n&255)*f)})`;
    } catch { return "#222"; }
  }

  // ── Minimap ───────────────────────────────────────────────
  _drawMinimap() {
    const { ctx, canvas } = this;
    const s = 0.115, ox = canvas.width - MAP.width*s - 10, oy = 10;
    ctx.save();
    ctx.globalAlpha = 0.78;
    ctx.fillStyle = "#07080f";
    ctx.fillRect(ox-2, oy-2, MAP.width*s+4, MAP.height*s+4);
    ctx.translate(ox, oy); ctx.scale(s, s);

    for (const r of MAP.rooms) {
      ctx.fillStyle = r.meetingZone ? "#0d2218" : "#0d1525";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = r.meetingZone ? "#4affa4" : "#1e3050";
      ctx.lineWidth = 6; ctx.strokeRect(r.x, r.y, r.w, r.h);
    }
    for (const c of MAP.corridors) {
      ctx.fillStyle = "#0d1525"; ctx.fillRect(c.x, c.y, c.w, c.h);
    }
    for (const [id, p] of Object.entries(this.players)) {
      if (id === this.local.id) continue;
      ctx.beginPath(); ctx.arc(p.x??600, p.y??130, 9, 0, Math.PI*2);
      ctx.fillStyle = p.alive ? (p.color ?? "#aaa") : "#333"; ctx.fill();
    }
    ctx.beginPath(); ctx.arc(this.lx, this.ly, 11, 0, Math.PI*2);
    ctx.fillStyle = "#fff"; ctx.fill();

    ctx.restore(); ctx.globalAlpha = 1;
  }

  // ── Public helpers ────────────────────────────────────────
  getLocalRoom() { return currentRoom(this.lx, this.ly); }
  teleport(x, y) { this.lx = x; this.ly = y; }

  getImpostorPosition() {
    const imp = Object.values(this.players).find(p => p.role === "impostor");
    return imp ? { x: imp.x, y: imp.y } : null;
  }

  /**
   * Find the nearest alive player (not self) within range px.
   * Returns the player object from Firebase or null.
   */
  findNearest(range = KILL_RANGE) {
    let closest = null, best = Infinity;
    for (const [id, p] of Object.entries(this.players)) {
      if (id === this.local.id || !p.alive) continue;
      const d = Math.hypot((p.x ?? 0) - this.lx, (p.y ?? 0) - this.ly);
      if (d < best && d <= range) { best = d; closest = { ...p, id }; }
    }
    return closest;
  }
}