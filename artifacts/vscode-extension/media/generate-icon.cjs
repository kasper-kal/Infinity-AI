// Generate a proper 128x128 PNG icon for the VS Code extension
// Uses no external dependencies - creates valid PNG from scratch

const fs = require('fs');

// PNG signature
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

function crc32(data) {
  let crc = 0xFFFFFFFF;
  const table = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  for (let i = 0; i < data.length; i++) {
    crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function writeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function createIHDR(width, height) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8;  // bit depth
  data[9] = 6;  // color type: truecolor with alpha
  data[10] = 0; // compression
  data[11] = 0; // filter
  data[12] = 0; // interlace
  return writeChunk('IHDR', data);
}

function createIDAT(pixels, width, height) {
  // Simple filtering: use filter type 0 (none) for each row
  const rawData = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0; // filter type
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const offset = 1 + y * (1 + width * 4) + x * 4;
      rawData[offset] = pixels[idx * 4];     // R
      rawData[offset + 1] = pixels[idx * 4 + 1]; // G
      rawData[offset + 2] = pixels[idx * 4 + 2]; // B
      rawData[offset + 3] = pixels[idx * 4 + 3]; // A
    }
  }

  // Compress with zlib (deflate)
  const zlib = require('zlib');
  const compressed = zlib.deflateSync(rawData);
  return writeChunk('IDAT', compressed);
}

function createIEND() {
  return writeChunk('IEND', Buffer.alloc(0));
}

// Create pixel data for the icon
const WIDTH = 128;
const HEIGHT = 128;
const pixels = new Uint8Array(WIDTH * HEIGHT * 4);

// Helper to set pixel
function setPixel(x, y, r, g, b, a = 255) {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
  const idx = (y * WIDTH + x) * 4;
  pixels[idx] = r;
  pixels[idx + 1] = g;
  pixels[idx + 2] = b;
  pixels[idx + 3] = a;
}

// Helper to get pixel
function getPixel(x, y) {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return [0, 0, 0, 0];
  const idx = (y * WIDTH + x) * 4;
  return [pixels[idx], pixels[idx + 1], pixels[idx + 2], pixels[idx + 3]];
}

// Linear interpolation
function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

// Gradient colors
const color1 = [0x63, 0x66, 0xf1]; // #6366f1
const color2 = [0x8b, 0x5c, 0xf6]; // #8b5cf6
const color3 = [0xec, 0x48, 0x99]; // #ec4899

// Draw rounded rectangle with gradient
function drawRoundedRectGradient() {
  const radius = 24;

  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      // Check if inside rounded rect
      let inside = true;
      const dx = x - WIDTH / 2;
      const dy = y - HEIGHT / 2;

      // Corner checks
      if (x < radius && y < radius) {
        const dist = Math.sqrt((x - radius) ** 2 + (y - radius) ** 2);
        if (dist > radius) inside = false;
      } else if (x >= WIDTH - radius && y < radius) {
        const dist = Math.sqrt((x - (WIDTH - radius)) ** 2 + (y - radius) ** 2);
        if (dist > radius) inside = false;
      } else if (x < radius && y >= HEIGHT - radius) {
        const dist = Math.sqrt((x - radius) ** 2 + (y - (HEIGHT - radius)) ** 2);
        if (dist > radius) inside = false;
      } else if (x >= WIDTH - radius && y >= HEIGHT - radius) {
        const dist = Math.sqrt((x - (WIDTH - radius)) ** 2 + (y - (HEIGHT - radius)) ** 2);
        if (dist > radius) inside = false;
      }

      if (!inside) continue;

      // Calculate gradient position (0 to 1)
      const t = (x + y) / (WIDTH + HEIGHT - 2);

      let r, g, b;
      if (t < 0.5) {
        const lt = t * 2;
        r = lerp(color1[0], color2[0], lt);
        g = lerp(color1[1], color2[1], lt);
        b = lerp(color1[2], color2[2], lt);
      } else {
        const lt = (t - 0.5) * 2;
        r = lerp(color2[0], color3[0], lt);
        g = lerp(color2[1], color3[1], lt);
        b = lerp(color2[2], color3[2], lt);
      }

      setPixel(x, y, r, g, b, 255);
    }
  }
}

// Draw infinity symbol (∞) as geometric shapes
function drawInfinitySymbol() {
  const centerX = WIDTH / 2;
  const centerY = HEIGHT / 2;
  const scale = 1.2;

  // Infinity symbol parameters
  const loopRadius = 20 * scale;
  const loopSpacing = 16 * scale;
  const thickness = 8 * scale;

  // Two circles side by side, connected
  const leftCenterX = centerX - loopSpacing / 2;
  const rightCenterX = centerX + loopSpacing / 2;
  const centerYPos = centerY + 4; // slight vertical adjustment

  // Draw thick infinity symbol
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const dx1 = x - leftCenterX;
      const dy1 = y - centerYPos;
      const dist1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);

      const dx2 = x - rightCenterX;
      const dy2 = y - centerYPos;
      const dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

      // Check if in the "figure 8" shape
      // Two circles overlapping
      const inLeftLoop = dist1 <= loopRadius + thickness/2 && dist1 >= loopRadius - thickness/2;
      const inRightLoop = dist2 <= loopRadius + thickness/2 && dist2 >= loopRadius - thickness/2;

      // Connection between loops (the crossing part)
      const inConnection = Math.abs(x - centerX) < thickness/2 &&
                           Math.abs(y - centerYPos) < loopRadius + thickness/2;

      if (inLeftLoop || inRightLoop || inConnection) {
        setPixel(x, y, 255, 255, 255, 255);
      }
    }
  }
}

// More accurate infinity symbol using parametric approach
function drawInfinitySymbolAccurate() {
  const centerX = WIDTH / 2;
  const centerY = HEIGHT / 2;
  const size = 35;
  const thickness = 7;

  // Use a more precise approach - sample the infinity curve
  // Infinity symbol: lemniscate of Bernoulli
  // Parametric: x = a * cos(t) / (1 + sin^2(t)), y = a * sin(t) * cos(t) / (1 + sin^2(t))

  // Draw by sampling many points along the curve
  const numPoints = 2000;
  const a = size;

  for (let i = 0; i < numPoints; i++) {
    const t = (i / numPoints) * Math.PI * 2;
    const denom = 1 + Math.sin(t) * Math.sin(t);
    const x = centerX + a * Math.cos(t) / denom;
    const y = centerY + a * Math.sin(t) * Math.cos(t) / denom;

    // Draw a circle at each point (thickness)
    for (let dy = -thickness; dy <= thickness; dy++) {
      for (let dx = -thickness; dx <= thickness; dx++) {
        if (dx * dx + dy * dy <= thickness * thickness) {
          setPixel(Math.round(x + dx), Math.round(y + dy), 255, 255, 255, 255);
        }
      }
    }
  }
}

// Execute drawing
drawRoundedRectGradient();
drawInfinitySymbolAccurate();

// Build PNG
const chunks = [
  PNG_SIGNATURE,
  createIHDR(WIDTH, HEIGHT),
  createIDAT(pixels, WIDTH, HEIGHT),
  createIEND()
];

const png = Buffer.concat(chunks);
fs.writeFileSync('/workspaces/Infinity-AI/artifacts/vscode-extension/media/icon.png', png);
console.log('Generated icon.png:', png.length, 'bytes');