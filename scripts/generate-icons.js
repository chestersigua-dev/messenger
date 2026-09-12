const fs = require('fs');
const path = require('path');

// Messenger SVG vector with signature Meta Messenger gradient and lightning bolt
const MESSENGER_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="messengerGrad" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#006AFF"/>
      <stop offset="30%" stop-color="#0084FF"/>
      <stop offset="60%" stop-color="#A033FF"/>
      <stop offset="100%" stop-color="#FF5277"/>
    </linearGradient>
    <filter id="dropShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="8" stdDeviation="16" flood-color="#006AFF" flood-opacity="0.35"/>
    </filter>
  </defs>
  <!-- Background Bubble -->
  <path filter="url(#dropShadow)" fill="url(#messengerGrad)" d="M256 32C132.3 32 32 126.8 32 243.6c0 66.5 32.7 125.7 83.8 165.1v71.3c0 9.8 10.9 15.6 19 10.1l78.8-53.7c13.7 3.8 28.1 5.9 42.4 5.9 123.7 0 224-94.8 224-211.6S379.7 32 256 32z"/>
  <!-- Lightning Bolt -->
  <path fill="#FFFFFF" d="M148 286l88-92c7.2-7.5 19.3-6.4 25 2.3l48.6 74.4c5.7 8.7 17.8 9.8 25 2.3l85.4-89.1c9.3-9.7-3.7-24.8-15.5-18.1l-88 50.1c-7.2 4.1-16.2 3.1-22.3-2.5l-48.6-44.5c-6.1-5.6-15.1-6.6-22.3-2.5l-89.8 51.2c-11.8 6.7-12.3 23.9-1.5 34.4z"/>
</svg>
`.trim();

/**
 * Packs array of PNG buffers into a valid Windows ICO file buffer
 */
function packPngsToIco(pngBuffers) {
  const count = pngBuffers.length;
  // Header: 6 bytes
  // Directory: 16 bytes per image
  const headerSize = 6;
  const dirEntrySize = 16;
  const headerAndDirSize = headerSize + count * dirEntrySize;

  let currentOffset = headerAndDirSize;
  const entries = [];

  for (const item of pngBuffers) {
    const { width, height, buffer } = item;
    entries.push({
      width: width >= 256 ? 0 : width,
      height: height >= 256 ? 0 : height,
      colorCount: 0,
      reserved: 0,
      planes: 1,
      bitCount: 32,
      bytesInRes: buffer.length,
      imageOffset: currentOffset,
      buffer
    });
    currentOffset += buffer.length;
  }

  const icoBuffer = Buffer.alloc(currentOffset);

  // Write ICO Header
  icoBuffer.writeUInt16LE(0, 0); // Reserved
  icoBuffer.writeUInt16LE(1, 2); // 1 = ICO, 2 = CUR
  icoBuffer.writeUInt16LE(count, 4); // Number of images

  // Write Directory Entries
  let entryPos = 6;
  for (const entry of entries) {
    icoBuffer.writeUInt8(entry.width, entryPos);
    icoBuffer.writeUInt8(entry.height, entryPos + 1);
    icoBuffer.writeUInt8(entry.colorCount, entryPos + 2);
    icoBuffer.writeUInt8(entry.reserved, entryPos + 3);
    icoBuffer.writeUInt16LE(entry.planes, entryPos + 4);
    icoBuffer.writeUInt16LE(entry.bitCount, entryPos + 6);
    icoBuffer.writeUInt32LE(entry.bytesInRes, entryPos + 8);
    icoBuffer.writeUInt32LE(entry.imageOffset, entryPos + 12);
    entryPos += 16;
  }

  // Write Image Buffers
  for (const entry of entries) {
    entry.buffer.copy(icoBuffer, entry.imageOffset);
  }

  return icoBuffer;
}

async function main() {
  const assetsDir = path.resolve(__dirname, '../assets');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  const svgPath = path.join(assetsDir, 'icon.svg');
  fs.writeFileSync(svgPath, MESSENGER_SVG, 'utf-8');
  console.log('Saved:', svgPath);

  // If running inside electron or with electron available
  let electron;
  try {
    electron = require('electron');
  } catch (e) {
    //
  }

  if (electron && electron.nativeImage) {
    const svgBuffer = Buffer.from(MESSENGER_SVG, 'utf-8');
    const sizes = [256, 128, 64, 48, 32, 16];
    const pngItems = [];

    for (const size of sizes) {
      const img = electron.nativeImage.createFromBuffer(svgBuffer, { width: size, height: size });
      const pngBuf = img.toPNG();
      pngItems.push({ width: size, height: size, buffer: pngBuf });
      if (size === 256) {
        fs.writeFileSync(path.join(assetsDir, 'icon.png'), pngBuf);
      }
      if (size === 32) {
        fs.writeFileSync(path.join(assetsDir, 'tray.png'), pngBuf);
      }
    }

    const appIcoBuffer = packPngsToIco(pngItems);
    fs.writeFileSync(path.join(assetsDir, 'icon.ico'), appIcoBuffer);

    const trayItems = pngItems.filter((i) => i.width <= 32);
    const trayIcoBuffer = packPngsToIco(trayItems);
    fs.writeFileSync(path.join(assetsDir, 'tray.ico'), trayIcoBuffer);

    console.log('Successfully generated icon.ico, icon.png, tray.ico, tray.png!');
  }
}

main().catch(console.error);
