const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIco = require('png-to-ico');

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
  </defs>
  <!-- Background Bubble -->
  <path fill="url(#messengerGrad)" d="M256 32C132.3 32 32 126.8 32 243.6c0 66.5 32.7 125.7 83.8 165.1v71.3c0 9.8 10.9 15.6 19 10.1l78.8-53.7c13.7 3.8 28.1 5.9 42.4 5.9 123.7 0 224-94.8 224-211.6S379.7 32 256 32z"/>
  <!-- Lightning Bolt -->
  <path fill="#FFFFFF" d="M148 286l88-92c7.2-7.5 19.3-6.4 25 2.3l48.6 74.4c5.7 8.7 17.8 9.8 25 2.3l85.4-89.1c9.3-9.7-3.7-24.8-15.5-18.1l-88 50.1c-7.2 4.1-16.2 3.1-22.3-2.5l-48.6-44.5c-6.1-5.6-15.1-6.6-22.3-2.5l-89.8 51.2c-11.8 6.7-12.3 23.9-1.5 34.4z"/>
</svg>
`.trim();

async function main() {
  const assetsDir = path.resolve(__dirname, '../assets');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  const svgPath = path.join(assetsDir, 'icon.svg');
  fs.writeFileSync(svgPath, MESSENGER_SVG, 'utf-8');
  console.log('Saved SVG:', svgPath);

  const svgBuffer = Buffer.from(MESSENGER_SVG);

  // Generate multi-size PNG buffers for ICO
  const sizes = [256, 128, 64, 48, 32, 16];
  const pngFiles = [];

  for (const size of sizes) {
    const filePath = path.join(assetsDir, `icon-${size}.png`);
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(filePath);
    pngFiles.push(filePath);
  }

  // Save main icon.png (256x256)
  fs.copyFileSync(path.join(assetsDir, 'icon-256.png'), path.join(assetsDir, 'icon.png'));
  fs.copyFileSync(path.join(assetsDir, 'icon-32.png'), path.join(assetsDir, 'tray.png'));

  // Generate valid Windows multi-resolution icon.ico
  const icoBuffer = await pngToIco(pngFiles);
  fs.writeFileSync(path.join(assetsDir, 'icon.ico'), icoBuffer);
  console.log('Generated icon.ico, size:', icoBuffer.length);

  // Generate tray icon (16, 24, 32)
  const trayFiles = [
    path.join(assetsDir, 'icon-32.png'),
    path.join(assetsDir, 'icon-16.png')
  ];
  const trayIcoBuffer = await pngToIco(trayFiles);
  fs.writeFileSync(path.join(assetsDir, 'tray.ico'), trayIcoBuffer);
  console.log('Generated tray.ico, size:', trayIcoBuffer.length);

  // Clean up temporary size-specific PNGs
  for (const f of pngFiles) {
    fs.unlinkSync(f);
  }

  console.log('Successfully generated crisp Windows icon assets!');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
