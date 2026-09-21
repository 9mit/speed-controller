const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// CRC32 table for PNG chunk generation
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[n] = c >>> 0;
}

function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        c = (crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)) >>> 0;
    }
    return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
    const typeBuf = Buffer.from(type, 'ascii');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    const chunkDataForCrc = Buffer.concat([typeBuf, data]);
    crcBuf.writeUInt32BE(crc32(chunkDataForCrc), 0);
    return Buffer.concat([lenBuf, chunkDataForCrc, crcBuf]);
}

function encodeRGBAtoPNG(width, height, rgbaBuffer) {
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    
    // IHDR
    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(width, 0);
    ihdrData.writeUInt32BE(height, 4);
    ihdrData[8] = 8; // 8 bits per channel
    ihdrData[9] = 6; // RGBA
    ihdrData[10] = 0; // deflate
    ihdrData[11] = 0; // filter method 0
    ihdrData[12] = 0; // non-interlaced
    const ihdrChunk = makeChunk('IHDR', ihdrData);

    // Scanlines with filter byte 0 (None)
    const scanlineLength = 1 + width * 4;
    const scanlines = Buffer.alloc(height * scanlineLength);
    for (let y = 0; y < height; y++) {
        const rowOffset = y * scanlineLength;
        scanlines[rowOffset] = 0; // filter byte
        const srcOffset = y * width * 4;
        rgbaBuffer.copy(scanlines, rowOffset + 1, srcOffset, srcOffset + width * 4);
    }

    const compressed = zlib.deflateSync(scanlines, { level: 9 });
    const idatChunk = makeChunk('IDAT', compressed);
    const iendChunk = makeChunk('IEND', Buffer.alloc(0));

    return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// Draw a modern, sleek speed/autopilot icon
function renderIcon(size) {
    const buf = Buffer.alloc(size * size * 4);
    const center = size / 2;
    const radius = size * 0.44;
    const cornerRadius = size * 0.22;

    function setPixel(x, y, r, g, b, a) {
        if (x < 0 || x >= size || y < 0 || y >= size) return;
        const idx = (Math.floor(y) * size + Math.floor(x)) * 4;
        const currentAlpha = buf[idx + 3] / 255;
        const srcAlpha = a / 255;
        const outAlpha = srcAlpha + currentAlpha * (1 - srcAlpha);
        if (outAlpha > 0) {
            buf[idx + 0] = Math.round((r * srcAlpha + buf[idx + 0] * currentAlpha * (1 - srcAlpha)) / outAlpha);
            buf[idx + 1] = Math.round((g * srcAlpha + buf[idx + 1] * currentAlpha * (1 - srcAlpha)) / outAlpha);
            buf[idx + 2] = Math.round((b * srcAlpha + buf[idx + 2] * currentAlpha * (1 - srcAlpha)) / outAlpha);
            buf[idx + 3] = Math.round(outAlpha * 255);
        }
    }

    // Distance to squircle / rounded rectangle
    function sdRoundedBox(px, py, bx, by, r) {
        const qx = Math.abs(px) - bx + r;
        const qy = Math.abs(py) - by + r;
        const outsideDist = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
        const insideDist = Math.min(Math.max(qx, qy), 0);
        return outsideDist + insideDist - r;
    }

    // Point in polygon (triangle)
    function isInsideTriangle(px, py, x1, y1, x2, y2, x3, y3) {
        const d1 = (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2);
        const d2 = (px - x3) * (y2 - y3) - (x2 - x3) * (py - y3);
        const d3 = (px - x1) * (y3 - y1) - (x3 - x1) * (py - y1);
        const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
        const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
        return !(hasNeg && hasPos);
    }

    // High quality supersampling 4x for crystal clear anti-aliasing
    const SS = 4;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            let rSum = 0, gSum = 0, bSum = 0, aSum = 0;

            for (let sy = 0; sy < SS; sy++) {
                for (let sx = 0; sx < SS; sx++) {
                    const px = x + (sx + 0.5) / SS;
                    const py = y + (sy + 0.5) / SS;
                    const nx = px - center;
                    const ny = py - center;

                    // Rounded Squircle Container
                    const distBox = sdRoundedBox(nx, ny, size * 0.44, size * 0.44, size * 0.24);
                    if (distBox > 0.5) continue; // Outside

                    // Background dark tech gradient: Midnight Blue -> Deep Violet-Slate
                    const tY = py / size;
                    const tX = px / size;
                    let bgR = Math.round(11 + 18 * tY);
                    let bgG = Math.round(15 + 16 * tY);
                    let bgB = Math.round(28 + 48 * tY);

                    // Glowing border: subtle cyan/violet gradient along top-left to bottom-right
                    if (distBox > -1.8) {
                        const borderT = (px + py) / (size * 2);
                        // Cyan (56, 189, 248) to Violet (168, 85, 247)
                        bgR = Math.round(56 * (1 - borderT) + 168 * borderT);
                        bgG = Math.round(189 * (1 - borderT) + 85 * borderT);
                        bgB = Math.round(248 * (1 - borderT) + 247 * borderT);
                    }

                    let pixelR = bgR;
                    let pixelG = bgG;
                    let pixelB = bgB;
                    let pixelA = 255;

                    // Soft drop anti-aliasing at outer edge
                    if (distBox > -0.5) {
                        pixelA = Math.max(0, Math.min(255, Math.round((0.5 - distBox) * 255)));
                    }

                    // Foreground Speed Glyph:
                    // Sleek Fast-Forward Double Chevrons (>>):
                    // Chevron 1:
                    const c1x1 = center - size * 0.26, c1y1 = center - size * 0.22;
                    const c1x2 = center + size * 0.02, c1y2 = center;
                    const c1x3 = center - size * 0.26, c1y3 = center + size * 0.22;

                    // Chevron 2:
                    const c2x1 = center - size * 0.02, c2y1 = center - size * 0.22;
                    const c2x2 = center + size * 0.26, c2y2 = center;
                    const c2x3 = center - size * 0.02, c2y3 = center + size * 0.22;

                    const inTri1 = isInsideTriangle(px, py, c1x1, c1y1, c1x2, c1y2, c1x3, c1y3);
                    const inTri2 = isInsideTriangle(px, py, c2x1, c2y1, c2x2, c2y2, c2x3, c2y3);

                    if (inTri1 || inTri2) {
                        // Electric Cyan / Teal to Violet Gradient
                        const fgT = (px - (center - size * 0.26)) / (size * 0.52);
                        pixelR = Math.round(56 * (1 - fgT) + 192 * fgT);
                        pixelG = Math.round(189 * (1 - fgT) + 132 * fgT);
                        pixelB = Math.round(248 * (1 - fgT) + 252 * fgT);
                        pixelA = 255;
                    }

                    rSum += pixelR * (pixelA / 255);
                    gSum += pixelG * (pixelA / 255);
                    bSum += pixelB * (pixelA / 255);
                    aSum += pixelA;
                }
            }

            const totalSamples = SS * SS;
            const avgA = aSum / totalSamples;
            if (avgA > 0) {
                const idx = (y * size + x) * 4;
                buf[idx + 0] = Math.round((rSum / totalSamples) * (255 / avgA));
                buf[idx + 1] = Math.round((gSum / totalSamples) * (255 / avgA));
                buf[idx + 2] = Math.round((bSum / totalSamples) * (255 / avgA));
                buf[idx + 3] = Math.round(avgA);
            }
        }
    }

    return encodeRGBAtoPNG(size, height = size, buf);
}

const rootDir = path.resolve(__dirname, '..');
[16, 48, 128].forEach(size => {
    const pngBuf = renderIcon(size);
    const outFile = path.join(rootDir, `icon${size}.png`);
    fs.writeFileSync(outFile, pngBuf);
    console.log(`Generated icon${size}.png (${pngBuf.length} bytes)`);
});
