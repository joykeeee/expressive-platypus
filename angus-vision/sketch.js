let video, recognizer, faceLandmarker, port, writer, connectBtn;
let connected = false;
let statusMsg = 'Click "Connect Arduino" below to start';
let candidate = 'None', stableFrames = 0, lastSent = '';
let smileScore = 0, frownScore = 0;
let ripples = [];

const STABLE = 8;             // frames a gesture must hold before it counts
const SMILE_THRESHOLD = 0.5;  // 0–1; lower = smaller smiles count
const FROWN_THRESHOLD = 0.3;  // 0–1; frowns score lower than smiles, so this starts lower
const COMMANDS = {
  // up
  Thumb_Up: 'U',
  ILoveYou: 'U',
  Frown: 'U',
  // down
  Thumb_Down: 'D',
  Middle_Finger: 'D',
  Closed_Fist: 'D',
  // wiggle
  Open_Palm: 'W',
  Pointing_Up: 'W',
  Smile: 'W',
};
const ACTIONS = { U: 'up', D: 'down', W: 'wiggle' };  // names shown on screen

// camera viewport, inset inside the pond border
const VW = 640, VH = 480, VX = 60, VY = 80;

// lily pads around the edge (x, y, radius, rotation, flower?)
const PADS = [
  { x: 28,  y: 36,  r: 18, a: 0.6 },
  { x: 30,  y: 250, r: 30, a: 5.6, flower: true },
  { x: 34,  y: 330, r: 20, a: 2.2 },
  { x: 732, y: 110, r: 28, a: 3.8 },
  { x: 728, y: 175, r: 18, a: 1.0 },
  { x: 726, y: 390, r: 32, a: 4.6, flower: true },
  { x: 735, y: 470, r: 18, a: 0.2 },
];
// reeds in the bottom corners (x, height, sway phase)
const REEDS = [
  [12, 110, 0], [26, 140, 1.7], [42, 95, 3.1],
  [722, 120, 0.8], [738, 145, 2.4], [752, 100, 4.0],
];

const VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const HAND_MODEL =
  'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';
const FACE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

async function setup() {
  createCanvas(VW + 120, VH + 160);

  // rounded font for the title and labels
  const font = document.createElement('link');
  font.rel = 'stylesheet';
  font.href = 'https://fonts.googleapis.com/css2?family=Fredoka:wght@400;600&display=swap';
  document.head.appendChild(font);
  textFont('Fredoka');

  video = createCapture(VIDEO);
  video.size(VW, VH);
  video.hide();

  connectBtn = createButton('Connect Arduino');
  connectBtn.style('font-size', '18px');
  connectBtn.style('padding', '10px 18px');
  connectBtn.style('margin-top', '10px');
  connectBtn.style('background', '#d93025');
  connectBtn.style('color', 'white');
  connectBtn.style('border', 'none');
  connectBtn.style('border-radius', '6px');
  connectBtn.style('cursor', 'pointer');
  connectBtn.mousePressed(connectSerial);

  if (!('serial' in navigator)) {
    statusMsg = 'This browser can\'t talk to the Arduino. Use Chrome or Edge.';
  }

  const { FilesetResolver, GestureRecognizer, FaceLandmarker } = await import(VISION);
  const files = await FilesetResolver.forVisionTasks(VISION + '/wasm');
  [recognizer, faceLandmarker] = await Promise.all([
    GestureRecognizer.createFromOptions(files, {
      baseOptions: { modelAssetPath: HAND_MODEL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 1,
    }),
    FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
    }),
  ]);
}

function draw() {
  const t = millis() / 1000;

  // --- detection (reads the raw camera, so the visual effects don't affect it) ---
  let label = 'Loading hand and face models…';
  if (recognizer && faceLandmarker && video.elt.readyState >= 2) {
    const g = detectGesture();
    const sentText = connected
      ? `sent: ${lastSent ? `${lastSent} (${ACTIONS[lastSent]})` : '–'}`
      : 'not sent (no Arduino)';
    label = `Gesture: ${g}  ·  smile ${smileScore.toFixed(2)}  ·  frown ${frownScore.toFixed(2)}  ·  ${sentText}`;
  }

  // --- drawing ---
  drawPond();
  drawViewport(t);
  drawPads(t);
  drawReeds(t);
  drawHUD(label);
}

// ---------------- gestures ----------------

function detectGesture() {
  const now = performance.now();

  // hand: middle finger first, then MediaPipe's built-in gestures
  const handRes = recognizer.recognizeForVideo(video.elt, now);
  let hand = 'None';
  if (handRes.landmarks.length && isMiddleFinger(handRes.landmarks[0])) {
    hand = 'Middle_Finger';
  } else if (handRes.gestures.length && handRes.gestures[0][0].score > 0.6) {
    hand = handRes.gestures[0][0].categoryName;
  }
  if (!COMMANDS[hand]) hand = 'None';   // victory etc. don't do anything

  // face: smile and frown scores (checked every other frame to save work)
  if (frameCount % 2 === 0) {
    const faceRes = faceLandmarker.detectForVideo(video.elt, now);
    smileScore = 0;
    frownScore = 0;
    if (faceRes.faceBlendshapes.length) {
      const cats = faceRes.faceBlendshapes[0].categories;
      const score = name => cats.find(c => c.categoryName === name)?.score ?? 0;
      smileScore = (score('mouthSmileLeft') + score('mouthSmileRight')) / 2;
      frownScore = (score('mouthFrownLeft') + score('mouthFrownRight')) / 2;
    }
  }
  let face = 'None';
  if (smileScore > SMILE_THRESHOLD) face = 'Smile';
  else if (frownScore > FROWN_THRESHOLD) face = 'Frown';

  // hand gestures win over the face
  const g = hand !== 'None' ? hand : face;

  // only act once the same gesture has held for a few frames
  if (g === candidate) stableFrames++;
  else { candidate = g; stableFrames = 0; }

  const cmd = COMMANDS[candidate];
  if (connected && cmd && stableFrames >= STABLE && cmd !== lastSent) {
    send(cmd);
    lastSent = cmd;
  }
  // hand and face both neutral for a few frames: allow the same gesture to fire again
  if (candidate === 'None' && stableFrames >= STABLE) lastSent = '';

  return g;
}

// middle finger straight, index/ring/pinky curled (thumb ignored)
function isMiddleFinger(lm) {
  const d = (a, b) => Math.hypot(lm[a].x - lm[b].x, lm[a].y - lm[b].y);
  const extended = (tip, joint) => d(0, tip) > d(0, joint) * 1.2;
  const curled = (tip, joint) => d(0, tip) < d(0, joint);
  return extended(12, 10) && curled(8, 6) && curled(16, 14) && curled(20, 18);
}

// ---------------- Angus-Vision drawing ----------------

function drawPond() {
  const ctx = drawingContext;
  const water = ctx.createLinearGradient(0, 0, 0, height);
  water.addColorStop(0, '#3f8f86');
  water.addColorStop(1, '#1f5d61');
  ctx.fillStyle = water;
  ctx.fillRect(0, 0, width, height);

  // a new ripple every so often, somewhere in the border
  if (frameCount % 35 === 0) {
    for (let i = 0; i < 10; i++) {
      const x = random(width), y = random(height);
      const inView = x > VX - 10 && x < VX + VW + 10 && y > VY - 10 && y < VY + VH + 10;
      if (!inView) { ripples.push({ x, y, r: 0 }); break; }
    }
  }
  noFill();
  strokeWeight(1.5);
  for (const rp of ripples) {
    rp.r += 0.5;
    stroke(220, 240, 235, 160 * (1 - rp.r / 55));
    ellipse(rp.x, rp.y, rp.r * 2, rp.r * 1.2);
    if (rp.r > 12) ellipse(rp.x, rp.y, (rp.r - 12) * 2, (rp.r - 12) * 1.2);
  }
  ripples = ripples.filter(rp => rp.r < 55);
  noStroke();
}

function drawViewport(t) {
  const ctx = drawingContext;
  const bobX = sin(t * 0.9) * 3;   // gentle head bob, like Angus floating
  const bobY = sin(t * 1.4) * 4;

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(VX, VY, VW, VH, 28);
  ctx.clip();

  // camera, mirrored and slightly zoomed so the bob never shows an edge
  push();
  translate(VX + VW / 2 + bobX, VY + VH / 2 + bobY);
  scale(-1, 1);
  imageMode(CENTER);
  image(video, 0, 0, VW * 1.06, VH * 1.06);
  pop();

  // soft pond-water tint
  noStroke();
  fill(30, 120, 110, 30);
  rect(VX, VY, VW, VH);

  // dark vignette around the edges (POV look)
  const vig = ctx.createRadialGradient(
    VX + VW / 2, VY + VH / 2, VH * 0.35,
    VX + VW / 2, VY + VH / 2, VW * 0.62
  );
  vig.addColorStop(0, 'rgba(8, 30, 28, 0)');
  vig.addColorStop(1, 'rgba(8, 30, 28, 0.75)');
  ctx.fillStyle = vig;
  ctx.fillRect(VX, VY, VW, VH);

  // Angus's own bill at the bottom of the view
  drawBill(VX + VW / 2 + bobX * 1.5, VY + VH + bobY * 1.5);

  // not connected: pulsing red tint
  if (!connected) {
    fill(217, 48, 37, 40 + 30 * sin(millis() / 300));
    rect(VX, VY, VW, VH);
  }
  ctx.restore();

  // viewport edge: sandy bank when connected, red when not
  noFill();
  if (connected) { stroke(222, 212, 170, 220); strokeWeight(6); }
  else { stroke(217, 48, 37); strokeWeight(10); }
  rect(VX, VY, VW, VH, 28);
  noStroke();
}

function drawBill(cx, y) {
  noStroke();
  fill(58, 52, 46);
  ellipse(cx, y + 40, 340, 190);        // bill outline
  fill(78, 71, 63);
  ellipse(cx, y + 48, 300, 160);        // top of the bill
  fill(255, 255, 255, 25);
  ellipse(cx - 40, y - 18, 120, 20);    // soft shine
  fill(35, 31, 28);
  ellipse(cx - 28, y - 20, 14, 8);      // nostrils
  ellipse(cx + 28, y - 20, 14, 8);
}

function drawPads(t) {
  for (const p of PADS) {
    push();
    translate(p.x, p.y + sin(t * 0.8 + p.x) * 1.5);
    rotate(p.a + sin(t * 0.5 + p.y) * 0.05);
    noStroke();
    fill(0, 40, 30, 60);
    arc(3, 4, p.r * 2, p.r * 1.7, 0.35, TWO_PI - 0.35, PIE);   // shadow
    fill(86, 150, 74);
    arc(0, 0, p.r * 2, p.r * 1.7, 0.35, TWO_PI - 0.35, PIE);   // pad with notch
    stroke(140, 190, 110, 150);
    strokeWeight(1);
    for (let k = 1; k < 6; k++) {                              // veins
      const ang = 0.35 + k * (TWO_PI - 0.7) / 6;
      line(0, 0, cos(ang) * p.r * 0.85, sin(ang) * p.r * 0.72);
    }
    noStroke();
    if (p.flower) {
      fill(240, 170, 190);
      for (let k = 0; k < 6; k++) {
        push(); rotate(k * TWO_PI / 6); ellipse(0, -7, 7, 14); pop();
      }
      fill(250, 215, 90);
      circle(0, 0, 7);
    }
    pop();
  }
}

function drawReeds(t) {
  for (const [x, h, phase] of REEDS) {
    const sway = sin(t * 1.1 + phase) * 6;
    const base = height;
    noFill();
    stroke(70, 110, 60);
    strokeWeight(3);
    bezier(x, base, x, base - h * 0.5, x + sway * 0.5, base - h * 0.8, x + sway, base - h);
    push();
    translate(x + sway, base - h + 18);
    noStroke();
    fill(110, 72, 44);
    rect(-4, -14, 8, 28, 4);   // cattail
    pop();
  }
  noStroke();
}

function drawHUD(label) {
  // title
  textAlign(LEFT, CENTER);
  textStyle(BOLD);
  textSize(30);
  fill(10, 40, 38, 150);
  text('Angus-Vision', VX + 2, 44);
  fill(245, 250, 240);
  text('Angus-Vision', VX, 42);
  const titleW = textWidth('Angus-Vision');
  textStyle(NORMAL);
  textSize(14);
  fill(225, 240, 232, 210);
  text('· what Angus the platypus sees', VX + titleW + 12, 45);

  // connection pill, top right
  pill(
    connected ? '● Arduino connected' : '● Arduino NOT connected',
    VX + VW, 28,
    connected ? color(30, 142, 62) : color(217, 48, 37),
    16, RIGHT
  );

  // gesture readout and, if needed, why it isn't connected
  pill(label, VX, VY + VH + 14, color(10, 40, 38, 170), 15, LEFT);
  if (!connected) pill(statusMsg, VX, VY + VH + 48, color(217, 48, 37, 220), 14, LEFT);
}

function pill(txt, x, y, bg, size, align) {
  textSize(size);
  textStyle(NORMAL);
  const w = textWidth(txt) + 24, h = size + 14;
  const left = align === RIGHT ? x - w : x;
  noStroke();
  fill(bg);
  rect(left, y, w, h, h / 2);
  fill(255);
  textAlign(LEFT, CENTER);
  text(txt, left + 12, y + h / 2 + 1);
}

// ---------------- Arduino connection ----------------

async function connectSerial() {
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600 });
    writer = port.writable.getWriter();
    port.addEventListener('disconnect', () =>
      markDisconnected('Arduino unplugged. Plug it back in and reconnect.')
    );
    connected = true;
    lastSent = '';
    connectBtn.hide();
  } catch (err) {
    connected = false;
    if (err.name === 'NotFoundError') {
      statusMsg = 'No port picked. Click Connect and choose the board.';
    } else if (err.name === 'InvalidStateError' || err.name === 'NetworkError') {
      statusMsg = 'Port busy. Close the Arduino Serial Monitor and try again.';
    } else {
      statusMsg = 'Could not connect: ' + err.message;
    }
  }
}

function markDisconnected(msg) {
  connected = false;
  writer = null;
  port = null;
  lastSent = '';
  statusMsg = msg;
  connectBtn.show();
}

async function send(c) {
  if (!connected || !writer) return;
  try {
    await writer.write(new TextEncoder().encode(c));
  } catch (e) {
    markDisconnected('Lost connection to the Arduino. Reconnect.');
  }
}
