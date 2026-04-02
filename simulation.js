/*
 * SmartGhat Road Safety System v3.0
 * Simulation Engine — FULLY FIXED & ENHANCED
 * Features: Ghat Road, Vehicles on Path, LED/Buzzer Alerts,
 *           Camera Feed in Blind Zone, Crash/Accident Animation
 * Convergence 2026 | HT202603
 */

'use strict';

// ─────────────────────────────────────────────
// CANVAS SETUP
// ─────────────────────────────────────────────
const canvas = document.getElementById('roadCanvas');
const ctx    = canvas.getContext('2d');

// Fix canvas internal resolution to match attribute
const CANVAS_W = 900;
const CANVAS_H = 520;
canvas.width  = CANVAS_W;
canvas.height = CANVAS_H;

// Polyfill roundRect for all browsers
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    this.beginPath();
    this.moveTo(x + r, y);
    this.arcTo(x + w, y,     x + w, y + h, r);
    this.arcTo(x + w, y + h, x,     y + h, r);
    this.arcTo(x,     y + h, x,     y,     r);
    this.arcTo(x,     y,     x + w, y,     r);
    this.closePath();
    return this;
  };
}

// ─────────────────────────────────────────────
// ROAD PATH — Ghat S-Curve with steep blind apex
// ─────────────────────────────────────────────
const roadWaypoints = [
  { x:   0, y: 400 },   // 0  Side A entry
  { x:  90, y: 390 },   // 1
  { x: 170, y: 370 },   // 2
  { x: 245, y: 340 },   // 3
  { x: 310, y: 300 },   // 4
  { x: 360, y: 255 },   // 5  curve begins
  { x: 400, y: 205 },   // 6
  { x: 440, y: 165 },   // 7  APEX — blind peak
  { x: 480, y: 195 },   // 8
  { x: 525, y: 240 },   // 9
  { x: 580, y: 280 },   // 10
  { x: 650, y: 310 },   // 11
  { x: 730, y: 330 },   // 12
  { x: 820, y: 345 },   // 13
  { x: 900, y: 355 },   // 14 Side B entry
];

// Build dense Catmull-Rom spline
function buildSpline(pts, samplesPerSegment) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[Math.min(pts.length - 1, i + 1)];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 0; s <= samplesPerSegment; s++) {
      const t  = s / samplesPerSegment;
      const t2 = t * t, t3 = t2 * t;
      out.push({
        x: 0.5 * ((2*p1.x) + (-p0.x+p2.x)*t + (2*p0.x-5*p1.x+4*p2.x-p3.x)*t2 + (-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
        y: 0.5 * ((2*p1.y) + (-p0.y+p2.y)*t + (2*p0.y-5*p1.y+4*p2.y-p3.y)*t2 + (-p0.y+3*p1.y-3*p2.y+p3.y)*t3)
      });
    }
  }
  return out;
}

const spline = buildSpline(roadWaypoints, 30);
const SLEN   = spline.length;

// Get position on road at t ∈ [0,1]
function roadPt(t) {
  const clamped = Math.max(0, Math.min(1, t));
  const raw = clamped * (SLEN - 1);
  const i   = Math.min(Math.floor(raw), SLEN - 2);
  const f   = raw - i;
  return { x: spline[i].x + (spline[i+1].x - spline[i].x) * f,
           y: spline[i].y + (spline[i+1].y - spline[i].y) * f };
}

// Get tangent angle at t
function roadAngle(t) {
  const d  = 0.004;
  const p1 = roadPt(Math.max(0, t - d));
  const p2 = roadPt(Math.min(1, t + d));
  return Math.atan2(p2.y - p1.y, p2.x - p1.x);
}

// ─────────────────────────────────────────────
// GLOBAL STATE
// ─────────────────────────────────────────────
const vehicles      = [];
const particles     = [];   // crash / debris particles
let vehicleId       = 0;
let weatherMode     = 'clear';
let alertActive     = false;
let crashActive     = false;
let crashPos        = null;
let crashTimer      = 0;
let autoRunning     = false;
let autoTimeouts    = [];
let buzzerInterval  = null;
let continuousBuzz  = null;
let audioCtx        = null;
let animFrame       = null;
let lastTS          = 0;
let frameCount      = 0;

// Detection zones
const ZONE_A = 0.20;   // Sensor A triggers if vehicle t < ZONE_A
const ZONE_B = 0.80;   // Sensor B triggers if vehicle t > ZONE_B
const BLIND_S = 0.35;
const BLIND_E = 0.65;
const CRASH_DIST = 0.07;  // t-distance threshold for collision

// Road width (half) and lane offset
const ROAD_HW    = 34;   // half total road width
const LANE_SHIFT = 9;    // px offset from centre for each lane
//  Side A vehicles travel the LEFT lane  (offset = +LANE_SHIFT in normal direction)
//  Side B vehicles travel the RIGHT lane (offset = -LANE_SHIFT in normal direction)
// "left" = +normal direction (toward the mountain / uphill side of road)

// ─────────────────────────────────────────────
// VEHICLE CONFIGS
// ─────────────────────────────────────────────
const V_CFG = {
  car:   { len:36, wid:16, col:'#3BAEE8', roof:'#1A80B0', label:'CAR',   spd:0.00080, emoji:'🚗' },
  truck: { len:54, wid:21, col:'#E87020', roof:'#A04010', label:'TRUCK', spd:0.00045, emoji:'🚛' },
  bike:  { len:22, wid:10, col:'#50E060', roof:'#30A040', label:'BIKE',  spd:0.00110, emoji:'🏍' },
  bus:   { len:60, wid:22, col:'#E04080', roof:'#A01050', label:'BUS',   spd:0.00038, emoji:'🚌' },
  auto:  { len:26, wid:12, col:'#F0C000', roof:'#C08000', label:'AUTO',  spd:0.00095, emoji:'🛺' },
};

// ─────────────────────────────────────────────
// VEHICLE MANAGEMENT
// ─────────────────────────────────────────────
function addVehicle(type, side) {
  if (!V_CFG[type]) return;
  const cfg = V_CFG[type];
  const dir = side === 'A' ? 1 : -1;
  const startT = side === 'A' ? 0.01 : 0.99;

  vehicles.push({
    id:      vehicleId++,
    type, side, dir,
    t:       startT,
    speed:   cfg.spd,
    cfg,
    active:  true,
    crashed: false,
  });

  logEvent(`[ENTER] ${cfg.emoji} ${cfg.label} entered from Side ${side}`, 'info');
  updateStatusBar();
}

function resetSimulation() {
  vehicles.length = 0;
  particles.length = 0;
  alertActive  = false;
  crashActive  = false;
  crashPos     = null;
  crashTimer   = 0;
  autoRunning  = false;
  autoTimeouts.forEach(clearTimeout);
  autoTimeouts = [];
  stopContinuousBuzz();
  if (buzzerInterval) { clearInterval(buzzerInterval); buzzerInterval = null; }
  clearAllAlerts();
  hideCrashOverlay();
  logEvent('[RESET] System reset — All clear, standing by', 'info');
  updateStatusBar();
}

function setWeather(mode, btn) {
  weatherMode = mode;
  document.querySelectorAll('.weather-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const labels = { clear:'☀️ Clear', fog:'🌫️ Fog', night:'🌙 Night', rain:'🌧️ Rain' };
  const icons  = { clear:'fa-sun', fog:'fa-smog', night:'fa-moon', rain:'fa-cloud-rain' };
  document.getElementById('statusWeather').innerHTML =
    `<i class="fas ${icons[mode]}"></i> <span>${labels[mode]}</span>`;
  logEvent(`[WEATHER] Switched to ${labels[mode]}`, 'info');
}

// ─────────────────────────────────────────────
// CRASH / COLLISION SYSTEM
// ─────────────────────────────────────────────
function spawnCrashParticles(x, y) {
  for (let i = 0; i < 60; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.5 + Math.random() * 5;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1,
      life: 1.0,
      decay: 0.018 + Math.random() * 0.02,
      size: 2 + Math.random() * 6,
      col: ['#FF4400','#FF8800','#FFCC00','#FF2222','#FFFFFF','#888888'][Math.floor(Math.random()*6)],
      type: Math.random() > 0.5 ? 'spark' : 'debris'
    });
  }
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.12;          // gravity
    p.vx *= 0.97;
    p.life -= p.decay;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

function drawParticles() {
  for (const p of particles) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life);
    if (p.type === 'spark') {
      ctx.strokeStyle = p.col;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 3, p.y - p.vy * 3);
      ctx.stroke();
    } else {
      ctx.fillStyle = p.col;
      ctx.beginPath();
      ctx.rect(p.x - p.size/2, p.y - p.size/2, p.size, p.size);
      ctx.fill();
    }
    ctx.restore();
  }
}

function checkCollisions() {
  if (crashActive) return;

  for (let i = 0; i < vehicles.length; i++) {
    for (let j = i + 1; j < vehicles.length; j++) {
      const a = vehicles[i];
      const b = vehicles[j];
      if (a.crashed || b.crashed) continue;
      if (a.side === b.side) continue;  // same direction can't head-on

      const dist = Math.abs(a.t - b.t);
      if (dist < CRASH_DIST) {
        triggerCrash(a, b);
        return;
      }
    }
  }
}

function triggerCrash(vA, vB) {
  crashActive = true;
  crashTimer  = 180;  // ~3 seconds at 60fps

  // Position crash at midpoint
  const midT = (vA.t + vB.t) / 2;
  crashPos   = roadPt(midT);

  vA.crashed = true;
  vB.crashed = true;
  vA.active  = false;
  vB.active  = false;

  spawnCrashParticles(crashPos.x, crashPos.y);

  // Play crash buzzer — aggressive pattern
  playCrashBuzzer();
  showCrashOverlay();
  activateFullAlert();

  logEvent(`💥 [CRASH!] COLLISION BETWEEN ${vA.cfg.emoji}${vA.cfg.label} (Side A) & ${vB.cfg.emoji}${vB.cfg.label} (Side B) — ACCIDENT DETECTED!`, 'danger');
  logEvent('[EMERGENCY] Buzzer alarm triggered! Warning signals active on all sides!', 'danger');

  // Auto-clear crash after 4 seconds
  setTimeout(() => {
    crashActive = false;
    crashPos    = null;
    // Remove crashed vehicles
    for (let i = vehicles.length - 1; i >= 0; i--) {
      if (vehicles[i].crashed) vehicles.splice(i, 1);
    }
    hideCrashOverlay();
    if (!vehicles.some(v => v.side === 'A') || !vehicles.some(v => v.side === 'B')) {
      clearAllAlerts();
    }
    stopContinuousBuzz();
    logEvent('[CLEARED] Crash scene cleared — Road safety system reset', 'success');
    updateStatusBar();
  }, 4000);
}

function drawCrashEffect() {
  if (!crashActive || !crashPos) return;

  const pulse = Math.sin(Date.now() * 0.025) * 0.5 + 0.5;

  // Explosion glow ring
  ctx.save();
  ctx.globalAlpha = 0.6 * pulse;
  const grad = ctx.createRadialGradient(crashPos.x, crashPos.y, 5, crashPos.x, crashPos.y, 60);
  grad.addColorStop(0, 'rgba(255,150,0,0.9)');
  grad.addColorStop(0.4, 'rgba(255,50,0,0.6)');
  grad.addColorStop(1, 'rgba(255,0,0,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(crashPos.x, crashPos.y, 60, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // CRASH text
  ctx.save();
  ctx.font = `bold ${20 + pulse * 8}px Orbitron, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = `rgba(255,${Math.floor(80 + 80*pulse)},0,${0.7 + 0.3*pulse})`;
  ctx.shadowColor = '#FF4400';
  ctx.shadowBlur = 20;
  ctx.fillText('💥 CRASH!', crashPos.x, crashPos.y - 70);
  ctx.restore();

  // Smoke puffs
  for (let k = 0; k < 3; k++) {
    const sx = crashPos.x + (k - 1) * 14 + Math.sin(Date.now() * 0.003 + k) * 6;
    const sy = crashPos.y - 20 - k * 10 - (Date.now() * 0.02 % 30);
    const alpha = Math.max(0, 0.4 - k * 0.1) * pulse;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#888888';
    ctx.beginPath();
    ctx.arc(sx, sy, 10 + k * 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function showCrashOverlay() {
  const el = document.getElementById('collisionAlert');
  el.classList.add('active', 'crash-mode');
  el.querySelector('.alert-text').textContent = '💥 ACCIDENT DETECTED!';
  el.querySelector('.alert-sub').textContent  = 'Crash at blind zone — Emergency alert active';
}
function hideCrashOverlay() {
  const el = document.getElementById('collisionAlert');
  el.classList.remove('active', 'crash-mode');
  el.querySelector('.alert-text').textContent = 'COLLISION RISK DETECTED!';
  el.querySelector('.alert-sub').textContent  = 'Vehicles approaching from both sides';
}

// ─────────────────────────────────────────────
// ALERT SYSTEM
// ─────────────────────────────────────────────
function activateFullAlert() {
  alertActive = true;
  ['warningA','warningB'].forEach(id => document.getElementById(id).classList.add('led-on'));
  ['buzzerA','buzzerB'].forEach(id => document.getElementById(id).classList.add('buzzer-active'));
  ['signA','signB'].forEach(id => document.getElementById(id).classList.add('sign-active'));
  ['leftPanel','rightPanel'].forEach(id => document.getElementById(id).classList.add('panel-alert'));
  document.getElementById('collisionAlert').classList.add('active');
  document.getElementById('statusAlert').innerHTML =
    '<i class="fas fa-exclamation-triangle" style="color:#ff4444"></i> <span style="color:#ff4444">⚠ COLLISION RISK!</span>';
  document.getElementById('statusLatency').innerHTML =
    '<i class="fas fa-clock"></i> <span style="color:#00ff88">Latency: ~142ms</span>';
  startBuzzerVisual();
  playAlertBuzzer();
}

function clearAllAlerts() {
  alertActive = false;
  ['warningA','warningB'].forEach(id => document.getElementById(id).classList.remove('led-on'));
  ['buzzerA','buzzerB'].forEach(id => document.getElementById(id).classList.remove('buzzer-active'));
  ['signA','signB'].forEach(id => document.getElementById(id).classList.remove('sign-active'));
  ['leftPanel','rightPanel'].forEach(id => document.getElementById(id).classList.remove('panel-alert'));
  document.getElementById('collisionAlert').classList.remove('active','crash-mode');
  document.getElementById('statusAlert').innerHTML =
    '<i class="fas fa-shield-alt" style="color:#00ff88"></i> <span>System: STANDBY</span>';
  document.getElementById('statusLatency').innerHTML =
    '<i class="fas fa-clock"></i> <span>Latency: —</span>';
  stopBuzzerVisual();
  stopContinuousBuzz();
}

function startBuzzerVisual() {
  if (buzzerInterval) return;
  buzzerInterval = setInterval(() => {
    document.querySelectorAll('.buzzer-display.buzzer-active').forEach(b => {
      b.style.transform = b.style.transform === 'scale(1.04)' ? 'scale(1)' : 'scale(1.04)';
    });
  }, 250);
}
function stopBuzzerVisual() {
  if (buzzerInterval) { clearInterval(buzzerInterval); buzzerInterval = null; }
  document.querySelectorAll('.buzzer-display').forEach(b => { b.style.transform = ''; });
}

// ─────────────────────────────────────────────
// SENSOR INDICATORS (side panels)
// ─────────────────────────────────────────────
function updateSensors() {
  const hasA = vehicles.some(v => v.active && v.side === 'A' && v.t < ZONE_A);
  const hasB = vehicles.some(v => v.active && v.side === 'B' && v.t > ZONE_B);

  document.getElementById('sensorA').classList.toggle('led-on', hasA);
  document.getElementById('sensorB').classList.toggle('led-on', hasB);

  const shouldAlert = hasA && hasB && !crashActive;
  if (shouldAlert && !alertActive) {
    activateFullAlert();
    logEvent('🚨 [CRITICAL] Vehicles detected BOTH sides — Collision risk! LED + Buzzer ACTIVE!', 'danger');
  } else if (!shouldAlert && alertActive && !crashActive) {
    clearAllAlerts();
  }
}

// ─────────────────────────────────────────────
// AUDIO
// ─────────────────────────────────────────────
function getAudioCtx() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e){}
  }
  return audioCtx;
}

function playAlertBuzzer() {
  const ac = getAudioCtx(); if (!ac) return;
  const freqs = [900, 1400, 900, 1400, 900, 1400];
  let t = ac.currentTime;
  freqs.forEach((f, i) => {
    const osc  = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain); gain.connect(ac.destination);
    osc.type = 'square';
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0.25, t + i * 0.14);
    gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.14 + 0.12);
    osc.start(t + i * 0.14);
    osc.stop(t + i * 0.14 + 0.13);
  });
}

function playCrashBuzzer() {
  const ac = getAudioCtx(); if (!ac) return;
  // Continuous alarm pattern for crash
  let fired = 0;
  function fireOnce() {
    if (fired > 12) return;
    fired++;
    const osc  = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain); gain.connect(ac.destination);
    osc.type = 'sawtooth';
    osc.frequency.value = fired % 2 === 0 ? 1800 : 600;
    gain.gain.setValueAtTime(0.35, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.18);
    osc.start(ac.currentTime);
    osc.stop(ac.currentTime + 0.19);
    setTimeout(fireOnce, 200);
  }
  fireOnce();
}

function stopContinuousBuzz() {
  if (continuousBuzz) { clearInterval(continuousBuzz); continuousBuzz = null; }
}

// ─────────────────────────────────────────────
// CAMERA DISPLAY (blind zone)
// ─────────────────────────────────────────────
function drawCameraFeed() {
  // Camera box shown above the blind-zone apex
  const camPt = roadPt(0.50);  // apex of the curve
  const cx = camPt.x;
  const cy = camPt.y - 80;
  const cw = 130, ch = 80;

  // Camera mount pole
  ctx.save();
  ctx.strokeStyle = '#777';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(cx, camPt.y - 30);
  ctx.lineTo(cx, cy + ch);
  ctx.stroke();

  // Camera housing (little box on pole top)
  ctx.fillStyle = '#222';
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(cx - 8, cy + ch - 10, 16, 12, 3);
  ctx.fill(); ctx.stroke();

  // Camera lens
  ctx.beginPath();
  ctx.arc(cx, cy + ch - 5, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#111';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy + ch - 5, 2, 0, Math.PI * 2);
  ctx.fillStyle = '#334499';
  ctx.fill();

  // Camera label above camera
  ctx.font = 'bold 9px Inter';
  ctx.fillStyle = '#aaffaa';
  ctx.textAlign = 'center';
  ctx.fillText('📷 CAM', cx, cy + ch - 15);

  // ── FEED DISPLAY SCREEN ──
  const sx = cx - cw / 2;
  const sy = cy;

  // Screen background
  ctx.fillStyle = '#0a0a12';
  ctx.strokeStyle = crashActive ? '#ff4400' :
                    alertActive ? '#ffaa00' : '#00cc66';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(sx, sy, cw, ch, 5);
  ctx.fill(); ctx.stroke();

  // Screen scanline overlay
  ctx.save();
  ctx.globalAlpha = 0.06;
  for (let row = sy + 2; row < sy + ch; row += 4) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + 2, row, cw - 4, 1);
  }
  ctx.restore();

  // Clip rendering to screen
  ctx.save();
  ctx.beginPath();
  ctx.rect(sx + 2, sy + 2, cw - 4, ch - 4);
  ctx.clip();

  // Draw what the camera "sees" — a miniature view of the road apex
  drawCameraScene(sx + 2, sy + 2, cw - 4, ch - 4);

  ctx.restore();

  // Screen header bar
  ctx.fillStyle = crashActive ? 'rgba(200,30,0,0.85)' :
                  alertActive ? 'rgba(200,100,0,0.85)' : 'rgba(0,80,40,0.85)';
  ctx.beginPath();
  ctx.rect(sx + 2, sy + 2, cw - 4, 13);
  ctx.fill();

  ctx.font = 'bold 7px Inter';
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'left';
  ctx.fillText('BLIND ZONE CAM', sx + 5, sy + 11);

  // REC blink
  if (frameCount % 60 < 30) {
    ctx.beginPath();
    ctx.arc(sx + cw - 8, sy + 8, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#ff2222';
    ctx.fill();
  }

  // Timestamp
  const now = new Date();
  const ts = now.toLocaleTimeString('en-IN', {hour:'2-digit',minute:'2-digit',second:'2-digit'});
  ctx.font = '6px JetBrains Mono, monospace';
  ctx.fillStyle = 'rgba(0,255,136,0.8)';
  ctx.textAlign = 'right';
  ctx.fillText(ts, sx + cw - 4, sy + ch - 4);

  // Camera status label
  ctx.font = 'bold 8px Inter';
  ctx.textAlign = 'center';
  ctx.fillStyle = crashActive ? '#ff4400' : alertActive ? '#ffaa00' : '#00ff88';
  ctx.fillText(
    crashActive ? '⚠ ACCIDENT' : alertActive ? '⚠ ALERT' : '● MONITORING',
    cx, cy - 4
  );

  ctx.restore();
}

// Draws a miniature version of what the camera sees at the apex
function drawCameraScene(sx, sy, sw, sh) {
  // Background sky
  const skyCol = weatherMode === 'night' ? '#040816' :
                 weatherMode === 'fog'   ? '#9aabb0' :
                 weatherMode === 'rain'  ? '#1a2535' : '#3a7abf';
  ctx.fillStyle = skyCol;
  ctx.fillRect(sx, sy, sw, sh);

  // Simple mountain silhouette inside feed
  ctx.fillStyle = weatherMode === 'night' ? '#0d1a08' :
                  weatherMode === 'fog'   ? '#6a7a68' : '#1e4010';
  ctx.beginPath();
  ctx.moveTo(sx, sy + sh * 0.7);
  ctx.lineTo(sx + sw * 0.15, sy + sh * 0.35);
  ctx.lineTo(sx + sw * 0.3,  sy + sh * 0.5);
  ctx.lineTo(sx + sw * 0.5,  sy + sh * 0.25);
  ctx.lineTo(sx + sw * 0.7,  sy + sh * 0.4);
  ctx.lineTo(sx + sw * 0.85, sy + sh * 0.3);
  ctx.lineTo(sx + sw,        sy + sh * 0.45);
  ctx.lineTo(sx + sw,        sy + sh);
  ctx.lineTo(sx,             sy + sh);
  ctx.closePath();
  ctx.fill();

  // Road strip in camera
  ctx.fillStyle = '#333';
  ctx.beginPath();
  ctx.moveTo(sx + sw * 0.3, sy + sh);
  ctx.lineTo(sx + sw * 0.7, sy + sh);
  ctx.lineTo(sx + sw * 0.6, sy + sh * 0.55);
  ctx.lineTo(sx + sw * 0.4, sy + sh * 0.55);
  ctx.closePath();
  ctx.fill();

  // Road center line
  ctx.strokeStyle = 'rgba(255,230,0,0.7)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(sx + sw * 0.5, sy + sh);
  ctx.lineTo(sx + sw * 0.5, sy + sh * 0.55);
  ctx.stroke();
  ctx.setLineDash([]);

  // Show vehicles from apex perspective
  const apexT = 0.50;
  for (const v of vehicles) {
    if (!v.active || v.crashed) continue;
    const dist = Math.abs(v.t - apexT);
    if (dist > 0.4) continue;

    // The closer to apex, the larger in feed
    const scale = Math.max(0.1, 1 - dist * 2);
    const xOff  = (v.t - apexT) * sw * 2.5;
    const vx    = sx + sw * 0.5 + xOff * (v.side === 'A' ? -1 : 1);
    const vy    = sy + sh * 0.75 - scale * 8;
    const vw    = 14 * scale;
    const vh    = 8  * scale;

    ctx.save();
    ctx.globalAlpha = Math.min(1, scale * 1.4);
    ctx.fillStyle   = v.cfg.col;
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth   = 0.5;
    ctx.beginPath();
    ctx.roundRect(vx - vw/2, vy - vh/2, vw, vh, 2);
    ctx.fill(); ctx.stroke();

    // Headlights in feed
    if (weatherMode === 'night' || weatherMode === 'fog') {
      ctx.fillStyle = '#ffffaa';
      ctx.shadowColor = '#ffff88';
      ctx.shadowBlur  = 5;
      ctx.beginPath();
      ctx.arc(vx + (v.side === 'B' ? -vw/2 : vw/2), vy, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  // Crash in camera feed
  if (crashActive && crashPos) {
    const pulse = Math.sin(Date.now() * 0.025) * 0.5 + 0.5;
    ctx.save();
    ctx.globalAlpha = 0.85 * pulse;
    const cg = ctx.createRadialGradient(sx + sw * 0.5, sy + sh * 0.65, 1, sx + sw * 0.5, sy + sh * 0.65, 22);
    cg.addColorStop(0, 'rgba(255,200,0,0.9)');
    cg.addColorStop(1, 'rgba(255,50,0,0)');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(sx + sw * 0.5, sy + sh * 0.65, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.font = 'bold 8px sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText('💥', sx + sw * 0.5, sy + sh * 0.62);
  }

  // Fog overlay in feed
  if (weatherMode === 'fog') {
    ctx.fillStyle = 'rgba(180,190,200,0.45)';
    ctx.fillRect(sx, sy, sw, sh);
  }

  // Night overlay
  if (weatherMode === 'night') {
    ctx.fillStyle = 'rgba(0,0,30,0.35)';
    ctx.fillRect(sx, sy, sw, sh);
  }

  // Rain in feed
  if (weatherMode === 'rain') {
    ctx.strokeStyle = 'rgba(180,210,240,0.5)';
    ctx.lineWidth = 0.5;
    for (let r = 0; r < 20; r++) {
      const rx = sx + (Math.sin(r * 71.3 + frameCount * 0.5) * 0.5 + 0.5) * sw;
      const ry = sy + ((frameCount * 1.5 + r * 17) % sh);
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx - 0.5, ry + 6);
      ctx.stroke();
    }
  }
}

// ─────────────────────────────────────────────
// BACKGROUND DRAWING
// ─────────────────────────────────────────────
function drawBackground() {
  // Full canvas fill first
  ctx.fillStyle = '#080e1a';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Sky
  const skyColors = {
    clear: ['#1a4a8e', '#5aa0d8'],
    fog:   ['#7a8a98', '#b0bec8'],
    night: ['#04091a', '#0a1535'],
    rain:  ['#162030', '#253850']
  };
  const [skyT, skyB] = skyColors[weatherMode] || skyColors.clear;
  const skyGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_H * 0.62);
  skyGrad.addColorStop(0, skyT);
  skyGrad.addColorStop(1, skyB);
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Celestial body
  if (weatherMode === 'clear') {
    // Sun
    const sg = ctx.createRadialGradient(780, 65, 4, 780, 65, 34);
    sg.addColorStop(0, '#fffde0');
    sg.addColorStop(1, '#ffc200');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(780, 65, 34, 0, Math.PI * 2);
    ctx.fill();
    // Rays
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.strokeStyle = 'rgba(255,200,0,0.25)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(780 + Math.cos(a) * 38, 65 + Math.sin(a) * 38);
      ctx.lineTo(780 + Math.cos(a) * 58, 65 + Math.sin(a) * 58);
      ctx.stroke();
    }
  } else if (weatherMode === 'night') {
    // Moon
    ctx.fillStyle = '#ddd8b0';
    ctx.beginPath();
    ctx.arc(760, 60, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0a1535'; // shadow
    ctx.beginPath();
    ctx.arc(770, 56, 18, 0, Math.PI * 2);
    ctx.fill();
    // Stars — deterministic positions
    for (let i = 0; i < 70; i++) {
      const sx = (Math.sin(i * 137.508) * 0.5 + 0.5) * CANVAS_W;
      const sy = (Math.cos(i * 97.31)   * 0.5 + 0.5) * 200;
      const sr = 0.5 + (Math.sin(i * 23.1 + frameCount * 0.02) * 0.5 + 0.5) * 1.2;
      ctx.fillStyle = `rgba(255,255,255,${0.5 + Math.sin(i * 3.7 + frameCount * 0.03) * 0.4})`;
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (weatherMode === 'rain') {
    // Storm clouds
    for (let c = 0; c < 5; c++) {
      const cx2 = 80 + c * 180;
      const cy2 = 40 + (c % 2) * 20;
      ctx.fillStyle = 'rgba(50,60,80,0.7)';
      ctx.beginPath();
      ctx.arc(cx2,      cy2,      55, 0, Math.PI * 2);
      ctx.arc(cx2 + 50, cy2 + 10, 45, 0, Math.PI * 2);
      ctx.arc(cx2 - 40, cy2 + 15, 40, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Mountains (far layer)
  const mCol1 = weatherMode === 'night' ? '#0d1a08' :
                weatherMode === 'fog'   ? '#828e80' :
                weatherMode === 'rain'  ? '#1a2820' : '#2a5018';
  ctx.fillStyle = mCol1;
  ctx.beginPath();
  ctx.moveTo(0, CANVAS_H);
  const mfar = [[0,340],[70,210],[160,255],[230,165],[320,215],[400,130],[480,110],[570,175],[660,145],[740,195],[830,155],[900,195],[900,340]];
  mfar.forEach(([x,y]) => ctx.lineTo(x, y));
  ctx.closePath();
  ctx.fill();

  // Mountains (near layer)
  const mCol2 = weatherMode === 'night' ? '#061008' :
                weatherMode === 'fog'   ? '#6a7870' :
                weatherMode === 'rain'  ? '#141e18' : '#1a3a10';
  ctx.fillStyle = mCol2;
  ctx.beginPath();
  ctx.moveTo(0, CANVAS_H);
  const mnear = [[0,365],[100,285],[180,315],[270,255],[355,275],[430,225],[510,250],[590,230],[670,260],[760,240],[850,265],[900,255],[900,365]];
  mnear.forEach(([x,y]) => ctx.lineTo(x, y));
  ctx.closePath();
  ctx.fill();

  // Ground (below road, above dashboard panel)
  const gGrad = ctx.createLinearGradient(0, CANVAS_H * 0.50, 0, CANVAS_H * 0.78);
  if (weatherMode === 'night') {
    gGrad.addColorStop(0, '#182010'); gGrad.addColorStop(1, '#0a1008');
  } else if (weatherMode === 'rain' || weatherMode === 'fog') {
    gGrad.addColorStop(0, '#4a5838'); gGrad.addColorStop(1, '#2a3020');
  } else {
    gGrad.addColorStop(0, '#366018'); gGrad.addColorStop(1, '#1e3808');
  }
  ctx.fillStyle = gGrad;
  ctx.fillRect(0, CANVAS_H * 0.50, CANVAS_W, CANVAS_H * 0.30);

  // Trees (simple triangles along road sides)
  drawTrees();

  // Weather overlays
  if (weatherMode === 'fog') {
    const fg = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    fg.addColorStop(0, 'rgba(190,200,210,0.55)');
    fg.addColorStop(0.6, 'rgba(170,185,195,0.35)');
    fg.addColorStop(1, 'rgba(150,165,180,0.2)');
    ctx.fillStyle = fg;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  if (weatherMode === 'rain') {
    ctx.save();
    ctx.strokeStyle = 'rgba(180,205,235,0.45)';
    ctx.lineWidth = 1;
    for (let r = 0; r < 100; r++) {
      const rx  = (Math.sin(r * 91.7) * 0.5 + 0.5) * CANVAS_W;
      const ry  = ((frameCount * 2.8 + r * 14) % (CANVAS_H + 20)) - 10;
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx - 1.5, ry + 12);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawTrees() {
  const treePositions = [0.04, 0.09, 0.14, 0.75, 0.82, 0.88, 0.93, 0.97];
  for (const tp of treePositions) {
    const pt = roadPt(tp);
    const an = roadAngle(tp);
    const nx = -Math.sin(an), ny = Math.cos(an);
    const ox = pt.x + nx * 54;
    const oy = pt.y + ny * 54;
    drawTree(ox, oy);
    const ox2 = pt.x - nx * 54;
    const oy2 = pt.y - ny * 54;
    drawTree(ox2, oy2);
  }
}
function drawTree(x, y) {
  const h = 24 + Math.sin(x * 0.3) * 6;
  const col = weatherMode === 'night' ? '#0d2008' :
              weatherMode === 'fog'   ? '#5a6858' : '#1a4810';
  // Trunk
  ctx.fillStyle = '#4a2800';
  ctx.fillRect(x - 2, y, 4, 8);
  // Foliage (3 triangles)
  for (let t = 0; t < 3; t++) {
    ctx.fillStyle = weatherMode === 'night' ? `rgba(15,40,15,${0.7 - t*0.1})` :
                                               `rgba(25,${70+t*10},15,${0.9 - t*0.1})`;
    ctx.beginPath();
    ctx.moveTo(x,            y - t * h * 0.22);
    ctx.lineTo(x - h * 0.32, y + h * 0.22 - t * h * 0.22);
    ctx.lineTo(x + h * 0.32, y + h * 0.22 - t * h * 0.22);
    ctx.closePath();
    ctx.fill();
  }
}

// ─────────────────────────────────────────────
// ROAD DRAWING
// ─────────────────────────────────────────────
function drawRoad() {
  // Road surface
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur  = 16;
  ctx.shadowOffsetY = 4;

  ctx.beginPath();
  for (let i = 0; i < SLEN; i++) {
    const p = spline[i];
    const a = roadAngle(i / SLEN);
    const nx = -Math.sin(a) * ROAD_HW, ny = Math.cos(a) * ROAD_HW;
    i === 0 ? ctx.moveTo(p.x + nx, p.y + ny) : ctx.lineTo(p.x + nx, p.y + ny);
  }
  for (let i = SLEN - 1; i >= 0; i--) {
    const p = spline[i];
    const a = roadAngle(i / SLEN);
    const nx = -Math.sin(a) * ROAD_HW, ny = Math.cos(a) * ROAD_HW;
    ctx.lineTo(p.x - nx, p.y - ny);
  }
  ctx.closePath();
  const rCol = weatherMode === 'rain' ? '#282828' :
               weatherMode === 'night'? '#1a1a1a' : '#303030';
  ctx.fillStyle = rCol;
  ctx.fill();
  ctx.restore();

  // Road texture (asphalt grain)
  ctx.save();
  ctx.globalAlpha = 0.04;
  for (let g = 0; g < SLEN; g += 3) {
    const p = spline[g];
    const a = roadAngle(g / SLEN);
    const nx = -Math.sin(a) * (ROAD_HW - 4), ny = Math.cos(a) * (ROAD_HW - 4);
    ctx.fillStyle = Math.random() > 0.5 ? '#fff' : '#000';
    ctx.beginPath();
    ctx.arc(p.x + (Math.random()-0.5)*nx*2, p.y + (Math.random()-0.5)*ny*2, 1, 0, Math.PI*2);
    ctx.fill();
  }
  ctx.restore();

  // White edge lines
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.setLineDash([]);
    for (let i = 0; i < SLEN; i++) {
      const p = spline[i];
      const a = roadAngle(i / SLEN);
      const w = ROAD_HW - 3;
      const nx = -Math.sin(a) * w, ny = Math.cos(a) * w;
      i === 0 ? ctx.moveTo(p.x + side*nx, p.y + side*ny)
              : ctx.lineTo(p.x + side*nx, p.y + side*ny);
    }
    ctx.strokeStyle = 'rgba(255,255,220,0.95)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  // Yellow centre dashes
  ctx.beginPath();
  ctx.setLineDash([16, 12]);
  for (let i = 0; i < SLEN; i++) {
    const p = spline[i];
    i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
  }
  ctx.strokeStyle = 'rgba(255,220,0,0.85)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.setLineDash([]);

  // Guardrails
  drawGuardrails();

  // Blind zone highlight
  drawBlindZone();

  // Camera
  drawCameraFeed();

  // Sensor posts
  drawSensorPost(roadPt(0.10), 'A', vehicles.some(v => v.active && v.side==='A' && v.t < ZONE_A));
  drawSensorPost(roadPt(0.90), 'B', vehicles.some(v => v.active && v.side==='B' && v.t > ZONE_B));
}

function drawGuardrails() {
  const off = ROAD_HW + 10;
  ctx.strokeStyle = 'rgba(190,190,190,0.7)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let i = 0; i < SLEN; i++) {
    const p = spline[i]; const a = roadAngle(i / SLEN);
    const nx = -Math.sin(a)*off, ny = Math.cos(a)*off;
    i === 0 ? ctx.moveTo(p.x - nx, p.y - ny) : ctx.lineTo(p.x - nx, p.y - ny);
  }
  ctx.stroke();

  // Posts every 20 pts
  for (let i = 0; i < SLEN; i += 20) {
    const p = spline[i]; const a = roadAngle(i / SLEN);
    const nx = -Math.sin(a)*off, ny = Math.cos(a)*off;
    ctx.strokeStyle = 'rgba(160,160,160,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x - nx, p.y - ny);
    ctx.lineTo(p.x - nx, p.y - ny + 10);
    ctx.stroke();
  }
}

function drawBlindZone() {
  const si = Math.floor(BLIND_S * SLEN);
  const ei = Math.floor(BLIND_E * SLEN);
  const bw = ROAD_HW + 8;
  const pulse = alertActive || crashActive
    ? 0.18 + 0.14 * Math.sin(Date.now() * 0.008) : 0.08;

  ctx.save();
  ctx.globalAlpha = pulse;
  ctx.beginPath();
  for (let i = si; i <= ei; i++) {
    const p = spline[i]; const a = roadAngle(i / SLEN);
    const nx = -Math.sin(a)*bw, ny = Math.cos(a)*bw;
    i === si ? ctx.moveTo(p.x + nx, p.y + ny) : ctx.lineTo(p.x + nx, p.y + ny);
  }
  for (let i = ei; i >= si; i--) {
    const p = spline[i]; const a = roadAngle(i / SLEN);
    const nx = -Math.sin(a)*bw, ny = Math.cos(a)*bw;
    ctx.lineTo(p.x - nx, p.y - ny);
  }
  ctx.closePath();
  ctx.fillStyle = crashActive ? '#ff2200' : alertActive ? '#ff6600' : '#ffaa00';
  ctx.fill();
  ctx.restore();

  // Zone label
  const mid = roadPt(0.48);
  ctx.save();
  ctx.font = 'bold 10px Inter';
  ctx.fillStyle = crashActive ? '#ff6644' : alertActive ? '#ffaa44' : '#ffcc44';
  ctx.textAlign = 'center';
  ctx.shadowColor = '#000'; ctx.shadowBlur = 5;
  ctx.fillText('⚠ BLIND ZONE', mid.x, mid.y - 46);
  ctx.restore();
}

function drawSensorPost(pos, label, active) {
  const t   = label === 'A' ? 0.10 : 0.90;
  const ang = roadAngle(t);
  const nx  = -Math.sin(ang), ny = Math.cos(ang);
  const px  = pos.x + nx * 30;
  const py  = pos.y + ny * 30;

  // Pole
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(px, py + 6);
  ctx.lineTo(px, py - 30);
  ctx.stroke();

  // Box
  const boxCol = active ? '#550000' : '#0a3a0a';
  ctx.fillStyle = boxCol;
  ctx.strokeStyle = active ? '#ff4400' : '#00aa44';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(px - 13, py - 45, 26, 18, 3);
  ctx.fill(); ctx.stroke();

  // LED
  const ledCol = active ? '#ff5500' : '#00ff55';
  if (active) {
    ctx.shadowColor = ledCol;
    ctx.shadowBlur  = 10 + 6 * Math.abs(Math.sin(Date.now() * 0.012));
  }
  ctx.fillStyle = ledCol;
  ctx.beginPath();
  ctx.arc(px, py - 37, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Label
  ctx.font = 'bold 8px Inter';
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.fillText(`NODE ${label}`, px, py - 50);

  // Sensor beam
  if (active) {
    ctx.save();
    ctx.globalAlpha = 0.25 + 0.15 * Math.sin(Date.now() * 0.01);
    const beam = ctx.createLinearGradient(
      px, py,
      px + (label === 'A' ? ROAD_HW * 2 : -ROAD_HW * 2), py
    );
    beam.addColorStop(0, '#ff5500');
    beam.addColorStop(1, 'rgba(255,85,0,0)');
    ctx.fillStyle = beam;
    ctx.fillRect(
      label === 'A' ? px : px - ROAD_HW * 2,
      py - 8, ROAD_HW * 2, 16
    );
    ctx.restore();
  }
}

// ─────────────────────────────────────────────
// VEHICLE DRAWING
// ─────────────────────────────────────────────
function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return { r, g, b };
}
function colLighten(hex, a) {
  const {r,g,b} = hexToRgb(hex);
  return `rgb(${Math.min(255,r+a)},${Math.min(255,g+a)},${Math.min(255,b+a)})`;
}
function colDarken(hex, a) {
  const {r,g,b} = hexToRgb(hex);
  return `rgb(${Math.max(0,r-a)},${Math.max(0,g-a)},${Math.max(0,b-a)})`;
}

function drawVehicle(v) {
  if (v.crashed) return;
  const rawPos   = roadPt(v.t);
  const rawAngle = roadAngle(v.t);

  // ── LANE POSITIONING ──────────────────────────────────────────
  // Normal vector (perpendicular, pointing to the upper/mountain side)
  const nx = -Math.sin(rawAngle);
  const ny =  Math.cos(rawAngle);
  // Side A = left lane  → shift in +normal direction
  // Side B = right lane → shift in -normal direction
  const laneSign = v.side === 'A' ? 1 : -1;
  const pos = {
    x: rawPos.x + nx * LANE_SHIFT * laneSign,
    y: rawPos.y + ny * LANE_SHIFT * laneSign
  };

  // Side A moves left→right (+t), Side B moves right→left (-t)
  const angle = v.dir === -1 ? rawAngle + Math.PI : rawAngle;
  const cfg   = v.cfg;
  const l2    = cfg.len / 2;
  const w2    = cfg.wid / 2;

  ctx.save();
  ctx.translate(pos.x, pos.y);
  ctx.rotate(angle);

  // Drop shadow
  ctx.save();
  ctx.shadowColor  = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur   = 10;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 4;

  // Body
  const bg = ctx.createLinearGradient(-l2, -w2, l2, w2);
  bg.addColorStop(0, colLighten(cfg.col, 30));
  bg.addColorStop(0.5, cfg.col);
  bg.addColorStop(1, colDarken(cfg.col, 25));
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(-l2, -w2, cfg.len, cfg.wid, 4);
  ctx.fill();
  ctx.restore();

  // Roof / cabin
  if (v.type !== 'bike') {
    let rLen, rX;
    if (v.type === 'truck') {
      rLen = cfg.len * 0.38; rX = -l2 + cfg.len * 0.50;
    } else if (v.type === 'bus') {
      rLen = cfg.len * 0.88; rX = -l2 + cfg.len * 0.06;
    } else {
      rLen = cfg.len * 0.55; rX = -rLen / 2;
    }
    ctx.fillStyle = cfg.roof;
    ctx.beginPath();
    ctx.roundRect(rX, -w2 + 2, rLen, cfg.wid - 4, 3);
    ctx.fill();
  }

  // Windscreen
  if (v.type !== 'bike') {
    ctx.fillStyle = 'rgba(190,235,255,0.55)';
    ctx.beginPath();
    ctx.fillRect(l2 - 11, -w2 + 3, 8, cfg.wid - 6);
    ctx.fill();
  }

  // Wheels
  const wpairs = v.type === 'bike'
    ? [[-l2 + 6, 0]]
    : [[-l2 + 8, -w2 - 2], [l2 - 8, -w2 - 2], [-l2 + 8, w2 + 2], [l2 - 8, w2 + 2]];
  if (v.type === 'bike') wpairs.push([l2 - 6, 0]);

  for (const [wx, wy] of wpairs) {
    const wr = v.type === 'bike' ? 5 : 4;
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(wx, wy, wr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#777';
    ctx.beginPath();
    ctx.arc(wx, wy, wr * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Headlights (front = +x direction after rotation)
  const isNight = weatherMode === 'night' || weatherMode === 'fog';
  ctx.fillStyle = isNight ? '#ffffc0' : '#ffffff';
  if (isNight) { ctx.shadowColor = '#ffff80'; ctx.shadowBlur = 18; }
  ctx.beginPath(); ctx.arc(l2 - 3, -w2 + 3, 2.5, 0, Math.PI * 2); ctx.fill();
  if (v.type !== 'bike') {
    ctx.beginPath(); ctx.arc(l2 - 3, w2 - 3, 2.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.shadowBlur = 0;

  // Tail lights
  ctx.fillStyle = '#ee1111';
  ctx.beginPath(); ctx.arc(-l2 + 3, -w2 + 3, 2, 0, Math.PI * 2); ctx.fill();
  if (v.type !== 'bike') {
    ctx.beginPath(); ctx.arc(-l2 + 3, w2 - 3, 2, 0, Math.PI * 2); ctx.fill();
  }

  // Side indicator / type label
  ctx.font = `bold ${Math.min(8, w2)}px Inter`;
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(cfg.label, 0, 0);

  ctx.restore();

  // Headlight beams (night/fog)
  if (isNight) drawHeadlightBeam(pos, angle, cfg);
}

function drawHeadlightBeam(pos, angle, cfg) {
  ctx.save();
  ctx.translate(pos.x, pos.y);
  ctx.rotate(angle);
  const bLen = weatherMode === 'fog' ? 45 : 80;
  const bg = ctx.createRadialGradient(cfg.len/2, 0, 0, cfg.len/2 + bLen*0.6, 0, bLen);
  bg.addColorStop(0, 'rgba(255,255,200,0.28)');
  bg.addColorStop(1, 'rgba(255,255,200,0)');
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.moveTo(cfg.len/2, 0);
  ctx.lineTo(cfg.len/2 + bLen, -20);
  ctx.lineTo(cfg.len/2 + bLen,  20);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ─────────────────────────────────────────────
// HUD overlays
// ─────────────────────────────────────────────
function drawHUD() {
  ctx.save();
  ctx.font = 'bold 11px Inter';
  ctx.shadowColor = '#000'; ctx.shadowBlur = 6;

  ctx.fillStyle = '#88ccff';
  ctx.textAlign = 'left';
  ctx.fillText('◄ SIDE A', 8, 438);

  ctx.fillStyle = '#ffaa88';
  ctx.textAlign = 'right';
  ctx.fillText('SIDE B ►', CANVAS_W - 8, 378);

  ctx.restore();

  // Zone sensor lines + warning boards
  const hasVehA = vehicles.some(v => v.active && !v.crashed && v.side === 'A');
  const hasVehB = vehicles.some(v => v.active && !v.crashed && v.side === 'B');
  drawZoneLine(ZONE_A, '#00ff88', hasVehA);
  drawZoneLine(ZONE_B, '#ff6644', hasVehB);

  // Warning sign boards at each sensor zone
  drawWarningBoard('A', hasVehB);   // Side A board warns when Side B has vehicle
  drawWarningBoard('B', hasVehA);   // Side B board warns when Side A has vehicle

  // Node screens (individual displays for Node A and Node B)
  drawNodeScreen('A');
  drawNodeScreen('B');
}

function drawZoneLine(t, col, active) {
  const pos = roadPt(t);
  const ang = roadAngle(t);
  const ext = ROAD_HW + 14;
  const nx = -Math.sin(ang) * ext;
  const ny =  Math.cos(ang) * ext;
  ctx.save();
  ctx.strokeStyle = active ? col : col;
  ctx.lineWidth   = active ? 2.5 : 1.5;
  ctx.setLineDash([5, 4]);
  ctx.globalAlpha = active ? 0.9 : 0.5;
  if (active) {
    ctx.shadowColor = col; ctx.shadowBlur = 8;
  }
  ctx.beginPath();
  ctx.moveTo(pos.x + nx, pos.y + ny);
  ctx.lineTo(pos.x - nx, pos.y - ny);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// ─────────────────────────────────────────────
// WARNING SIGN BOARDS at sensor zone lines
// ─────────────────────────────────────────────
// 'side' is which side the board stands at (A = green line, B = red line)
// 'warn' = true when a vehicle from the OPPOSITE side has been detected
function drawWarningBoard(side, warn) {
  const t      = side === 'A' ? ZONE_A : ZONE_B;
  const pos    = roadPt(t);
  const ang    = roadAngle(t);
  const nx     = -Math.sin(ang);
  const ny     =  Math.cos(ang);

  // The board stands on the OUTSIDE edge of the road (upper/cliff side)
  // For node A (left entry) it sits above the road
  // For node B (right entry) it sits above the road
  const boardOff = ROAD_HW + 52;   // how far from road centre
  const bx = pos.x + nx * boardOff;
  const by = pos.y + ny * boardOff;

  const bw = 88, bh = 52;
  const pulse = warn ? 0.7 + 0.3 * Math.sin(Date.now() * 0.012) : 1.0;

  ctx.save();

  // Pole
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(bx, by + bh / 2);
  ctx.lineTo(bx, by + bh / 2 + 30);
  ctx.stroke();

  // Board body
  const boardBg  = warn ? `rgba(180,30,0,${0.88 * pulse})`  : 'rgba(20,40,20,0.82)';
  const boardBdr = warn ? `rgba(255,${Math.floor(80+80*pulse)},0,0.9)` : 'rgba(0,200,80,0.5)';

  ctx.fillStyle   = boardBg;
  ctx.strokeStyle = boardBdr;
  ctx.lineWidth   = warn ? 2.5 : 1.5;
  if (warn) {
    ctx.shadowColor = '#ff4400';
    ctx.shadowBlur  = 14 * pulse;
  }
  ctx.beginPath();
  ctx.roundRect(bx - bw / 2, by - bh / 2, bw, bh, 6);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Warning triangle
  if (warn) {
    ctx.fillStyle = `rgba(255,${Math.floor(180+60*pulse)},0,${pulse})`;
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⚠', bx - bw / 2 + 14, by);
  }

  // Main text — top line
  const topText = warn
    ? (side === 'A' ? '⬅ VEHICLE' : 'VEHICLE ➡')
    : (side === 'A' ? 'NODE A' : 'NODE B');
  ctx.font      = `bold ${warn ? 10 : 9}px Inter`;
  ctx.fillStyle = warn ? '#ffffff' : '#88cc88';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(topText, bx + (warn ? 6 : 0), by - 10);

  // Sub text
  const subText = warn
    ? 'COMING FROM ' + (side === 'A' ? 'LEFT' : 'RIGHT')
    : '● MONITORING';
  ctx.font      = `bold ${warn ? 8 : 7}px Inter`;
  ctx.fillStyle = warn ? '#ffcc66' : '#448844';
  ctx.fillText(subText, bx, by + 2);

  // SLOW DOWN text
  if (warn) {
    ctx.font      = `bold 9px Orbitron, monospace`;
    ctx.fillStyle = `rgba(255,255,0,${pulse})`;
    ctx.fillText('SLOW DOWN!', bx, by + 14);
  }

  // Side label tag
  ctx.font      = 'bold 7px JetBrains Mono, monospace';
  ctx.fillStyle = side === 'A' ? '#00ff88' : '#ff6644';
  ctx.fillText(`SENSOR ZONE ${side}`, bx, by - bh / 2 - 5);

  ctx.restore();
}

// ─────────────────────────────────────────────
// NODE SCREEN — individual display for each sensor node
// Shown inline on the canvas near the sensor post
// ─────────────────────────────────────────────
function drawNodeScreen(side) {
  const nodeT  = side === 'A' ? 0.10 : 0.90;
  const pos    = roadPt(nodeT);
  const ang    = roadAngle(nodeT);
  const nx     = -Math.sin(ang);
  const ny     =  Math.cos(ang);

  // Screen is placed on the ROAD SIDE (below the sensor post)
  const screenOff = ROAD_HW + 58;
  const sx = pos.x - nx * screenOff;  // opposite side from warning board
  const sy = pos.y - ny * screenOff;

  const sw = 100, sh = 72;
  const bx = sx - sw / 2;
  const by = sy - sh / 2;

  // Is this node actively detecting?
  const localDetect = side === 'A'
    ? vehicles.some(v => v.active && !v.crashed && v.side === 'A' && v.t < ZONE_A)
    : vehicles.some(v => v.active && !v.crashed && v.side === 'B' && v.t > ZONE_B);

  // Is remote node detecting? (opposite side)
  const remoteDetect = side === 'A'
    ? vehicles.some(v => v.active && !v.crashed && v.side === 'B')
    : vehicles.some(v => v.active && !v.crashed && v.side === 'A');

  const isCrash  = crashActive;
  const isAlert  = alertActive || isCrash;
  const pulse    = Math.sin(Date.now() * 0.014) * 0.5 + 0.5;

  ctx.save();

  // Pole from road edge to screen
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pos.x - nx * (ROAD_HW + 2), pos.y - ny * (ROAD_HW + 2));
  ctx.lineTo(sx, sy);
  ctx.stroke();

  // Screen border glow
  let borderCol, bgCol;
  if (isCrash) {
    borderCol = `rgba(255,100,0,${0.7+0.3*pulse})`;
    bgCol     = `rgba(80,10,0,0.95)`;
  } else if (isAlert) {
    borderCol = `rgba(255,180,0,${0.6+0.4*pulse})`;
    bgCol     = `rgba(40,20,0,0.95)`;
  } else if (localDetect) {
    borderCol = `rgba(0,255,136,0.85)`;
    bgCol     = `rgba(0,20,10,0.95)`;
  } else {
    borderCol = `rgba(0,120,80,0.5)`;
    bgCol     = `rgba(5,15,10,0.90)`;
  }

  if (isAlert || localDetect) {
    ctx.shadowColor = borderCol; ctx.shadowBlur = 12;
  }
  ctx.fillStyle   = bgCol;
  ctx.strokeStyle = borderCol;
  ctx.lineWidth   = isAlert ? 2 : 1.5;
  ctx.beginPath();
  ctx.roundRect(bx, by, sw, sh, 6);
  ctx.fill(); ctx.stroke();
  ctx.shadowBlur = 0;

  // ── Screen scanlines ──
  ctx.save();
  ctx.globalAlpha = 0.05;
  for (let row = by + 2; row < by + sh; row += 4) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(bx + 2, row, sw - 4, 1);
  }
  ctx.restore();

  // ── Header bar ──
  const hdrCol = isCrash ? 'rgba(200,40,0,0.9)'
               : isAlert ? 'rgba(160,80,0,0.9)'
               : localDetect ? 'rgba(0,80,50,0.9)' : 'rgba(0,40,25,0.85)';
  ctx.fillStyle = hdrCol;
  ctx.beginPath();
  ctx.rect(bx + 2, by + 2, sw - 4, 14);
  ctx.fill();

  ctx.font = 'bold 7.5px JetBrains Mono, monospace';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`NODE ${side} — IoT SCREEN`, bx + 6, by + 9);

  // REC dot
  if (frameCount % 60 < 30) {
    ctx.beginPath(); ctx.arc(bx + sw - 8, by + 9, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#ff2222'; ctx.fill();
  }

  // ── Body content ──
  const lineY1 = by + 22;
  const lineY2 = by + 34;
  const lineY3 = by + 46;
  const lineY4 = by + 58;

  // LOCAL SENSOR status
  ctx.font = 'bold 8px Inter';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#888';
  ctx.fillText('LOCAL:', bx + 6, lineY1);
  ctx.font = 'bold 8px Inter';
  ctx.fillStyle = localDetect ? '#00ff88' : '#446644';
  ctx.fillText(localDetect ? '● VEHICLE DETECTED' : '○ CLEAR', bx + 42, lineY1);

  // REMOTE status
  ctx.font = 'bold 8px Inter';
  ctx.fillStyle = '#888';
  ctx.textAlign = 'left';
  ctx.fillText('REMOTE:', bx + 6, lineY2);
  ctx.fillStyle = remoteDetect ? '#ffaa00' : '#446644';
  ctx.fillText(remoteDetect ? '● VEH ON OTHER SIDE' : '○ CLEAR', bx + 42, lineY2);

  // WARNING line
  if (isCrash) {
    ctx.font = `bold ${8 + Math.floor(pulse * 2)}px Orbitron, monospace`;
    ctx.fillStyle = `rgba(255,${Math.floor(80+80*pulse)},0,1)`;
    ctx.textAlign = 'center';
    ctx.fillText('💥 ACCIDENT!', sx, lineY3);
  } else if (isAlert) {
    ctx.font = `bold 8px Orbitron, monospace`;
    ctx.fillStyle = `rgba(255,${Math.floor(150+80*pulse)},0,1)`;
    ctx.textAlign = 'center';
    ctx.fillText('⚠ COLLISION RISK!', sx, lineY3);
  } else if (localDetect || remoteDetect) {
    ctx.font = 'bold 8px Inter';
    ctx.fillStyle = '#ffcc44';
    ctx.textAlign = 'center';
    ctx.fillText('⚡ ALERT TRANSMITTED', sx, lineY3);
  } else {
    ctx.font = '7px JetBrains Mono, monospace';
    ctx.fillStyle = '#224422';
    ctx.textAlign = 'center';
    ctx.fillText('ALL CLEAR — MONITORING', sx, lineY3);
  }

  // Count of vehicles detected
  const vCountLocal  = vehicles.filter(v => v.active && !v.crashed && v.side === side).length;
  const vCountRemote = vehicles.filter(v => v.active && !v.crashed && v.side !== side).length;
  ctx.font = '7px JetBrains Mono, monospace';
  ctx.fillStyle = '#446644';
  ctx.textAlign = 'left';
  ctx.fillText(`VEH: L=${vCountLocal} R=${vCountRemote}`, bx + 6, lineY4);

  // Timestamp
  const ts = new Date().toLocaleTimeString('en-IN', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
  ctx.font = '7px JetBrains Mono, monospace';
  ctx.fillStyle = '#336633';
  ctx.textAlign = 'right';
  ctx.fillText(ts, bx + sw - 4, lineY4);

  // Label above screen
  ctx.font = 'bold 8px Inter';
  ctx.fillStyle = side === 'A' ? '#00ff88' : '#ff7755';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`📺 NODE ${side} DISPLAY`, sx, by - 4);

  ctx.restore();
}

// ─────────────────────────────────────────────
// EVENT LOG
// ─────────────────────────────────────────────
function logEvent(msg, type = 'info') {
  const log = document.getElementById('eventLog');
  if (!log) return;
  const ts  = new Date().toLocaleTimeString('en-IN', {hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const div = document.createElement('div');
  div.className   = `log-entry ${type}`;
  div.textContent = `[${ts}] ${msg}`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  while (log.children.length > 35) log.removeChild(log.firstChild);
}

// ─────────────────────────────────────────────
// STATUS BAR
// ─────────────────────────────────────────────
function updateStatusBar() {
  const el = document.getElementById('statusVehicles');
  if (el) el.innerHTML = `<i class="fas fa-car"></i> <span>Vehicles: ${vehicles.filter(v=>!v.crashed).length}</span>`;
}

// ─────────────────────────────────────────────
// AUTO DEMO
// ─────────────────────────────────────────────
function autoDemo() {
  if (autoRunning) return;
  autoRunning = true;
  resetSimulation();
  logEvent('[AUTO DEMO] Starting demonstration sequence...', 'info');

  function qt(fn, ms) {
    const id = setTimeout(fn, ms);
    autoTimeouts.push(id);
    return id;
  }

  qt(() => addVehicle('car',   'A'), 600);
  qt(() => logEvent('[SENSOR A] Car detected — broadcasting to Node B via LoRa', 'warning'), 1400);
  qt(() => addVehicle('truck', 'B'), 2800);
  qt(() => logEvent('[SENSOR B] Truck detected — broadcasting to Node A via LoRa', 'warning'), 3400);
  qt(() => addVehicle('bike',  'A'), 5200);
  qt(() => addVehicle('bus',   'B'), 7500);
  qt(() => {
    logEvent('[AUTO DEMO] Complete — watch the collision system in action!', 'success');
    autoRunning = false;
  }, 9000);
}

// ─────────────────────────────────────────────
// MAIN RENDER LOOP — FIXED & ROBUST
// ─────────────────────────────────────────────
function renderLoop(ts) {
  animFrame = requestAnimationFrame(renderLoop);
  frameCount++;

  // Move vehicles
  for (let i = vehicles.length - 1; i >= 0; i--) {
    const v = vehicles[i];
    if (!v.active || v.crashed) continue;
    v.t += v.dir * v.speed;
    if (v.t > 1.03 || v.t < -0.03) {
      logEvent(`[EXIT] ${v.cfg.emoji} ${v.cfg.label} (Side ${v.side}) exited the road`, 'info');
      vehicles.splice(i, 1);
      updateStatusBar();
    }
  }

  // Check for collisions
  if (!crashActive) checkCollisions();

  // Update particles
  updateParticles();

  // Sensor checks
  updateSensors();

  // ── DRAW ──
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  drawBackground();
  drawRoad();   // road surface, guardrails, blind zone, camera, sensor posts

  // Draw vehicles sorted by y-position (depth) — BEFORE HUD so signs overlay on top
  const sorted = [...vehicles].filter(v => !v.crashed)
    .sort((a, b) => roadPt(a.t).y - roadPt(b.t).y);
  for (const v of sorted) drawVehicle(v);

  // HUD LAST (zone lines, warning boards, node screens) — renders over vehicles
  drawHUD();

  // Crash effects and particles on very top
  drawCrashEffect();
  drawParticles();
}

// Kick off
requestAnimationFrame(renderLoop);
