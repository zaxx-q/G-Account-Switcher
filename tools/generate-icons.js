/**
 * Generate simple PNG icon files for the extension.
 * Uses only Node.js built-in modules (no canvas dependency).
 * Creates a blue circle with "G" approximated as pixels.
 *
 * Usage: node tools/generate-icons.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ICON_DIR = path.join(__dirname, '..', 'src', 'icons');

// Create icons directory
if (!fs.existsSync(ICON_DIR)) {
  fs.mkdirSync(ICON_DIR, { recursive: true });
}

/**
 * Create a simple PNG file with a blue circle.
 * Uses raw PNG encoding with zlib deflate.
 */
function createPNG(width, height, pixelCallback) {
  // Raw pixel data with filter byte per row
  const rawData = Buffer.alloc((width * 4 + 1) * height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * (width * 4 + 1);
    rawData[rowOffset] = 0; // Filter: None

    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelCallback(x, y, width, height);
      const pixelOffset = rowOffset + 1 + x * 4;
      rawData[pixelOffset] = r;
      rawData[pixelOffset + 1] = g;
      rawData[pixelOffset + 2] = b;
      rawData[pixelOffset + 3] = a;
    }
  }

  // Compress with deflate
  const compressed = zlib.deflateSync(rawData);

  // Build PNG file
  const chunks = [];

  // PNG signature
  chunks.push(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  chunks.push(createChunk('IHDR', ihdr));

  // IDAT chunk
  chunks.push(createChunk('IDAT', compressed));

  // IEND chunk
  chunks.push(createChunk('IEND', Buffer.alloc(0)));

  return Buffer.concat(chunks);
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuffer, data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData), 0);

  return Buffer.concat([length, typeBuffer, data, crc]);
}

// CRC32 implementation for PNG
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ 0xEDB88320;
      } else {
        crc = crc >>> 1;
      }
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Draw a blue circle with a white "G" shape.
 */
function iconPixel(x, y, w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const r = w / 2 - 0.5;

  // Distance from center
  const dx = x - cx + 0.5;
  const dy = y - cy + 0.5;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Anti-aliased circle edge
  const edgeDist = r - dist;

  if (edgeDist < -1) {
    return [0, 0, 0, 0]; // Outside circle
  }

  const alpha = Math.min(1, Math.max(0, edgeDist + 0.5));

  // Check if pixel is in the "G" shape
  const isG = isInG(dx, dy, r);

  if (isG) {
    // White pixel for the "G"
    return [255, 255, 255, Math.round(alpha * 255)];
  }

  // Blue background (#1a73e8)
  return [26, 115, 232, Math.round(alpha * 255)];
}

/**
 * Simple "G" shape detection using geometric primitives.
 */
function isInG(dx, dy, R) {
  const innerR = R * 0.65;
  const outerR = R * 0.78;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // G is a C-shape (arc) + horizontal bar

  // Arc part: ring between innerR and outerR
  if (dist >= innerR && dist <= outerR) {
    const angle = Math.atan2(dy, dx);
    // Open the C on the right side (roughly -30° to +30°)
    if (angle > -Math.PI * 0.2 && angle < Math.PI * 0.22) {
      // This is the gap in the C, except for the horizontal bar
      return false;
    }
    return true;
  }

  // Horizontal bar of the G (extends from center to the right edge of the ring)
  const barHeight = R * 0.12;
  if (dy >= -barHeight && dy <= barHeight) {
    if (dx >= 0 && dx <= outerR) {
      return true;
    }
  }

  return false;
}

// Generate icons
const sizes = [16, 32, 48, 128];

sizes.forEach(size => {
  const png = createPNG(size, size, iconPixel);
  const filename = `icon${size}.png`;
  const filepath = path.join(ICON_DIR, filename);
  fs.writeFileSync(filepath, png);
  console.log(`Created ${filepath} (${png.length} bytes)`);
});

console.log('\nAll icons generated successfully!');
