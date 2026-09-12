import { BrowserWindow, nativeImage } from 'electron';

/**
 * Creates an SVG badge icon as a Buffer for Windows taskbar overlay.
 */
function createBadgeSvg(count: number): Buffer {
  const displayCount = count > 99 ? '99+' : count.toString();
  const fontSize = count > 99 ? 12 : count > 9 ? 14 : 16;

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="15" fill="#FA3E3E" stroke="#FFFFFF" stroke-width="2"/>
      <text x="16" y="21" font-family="-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif" 
            font-size="${fontSize}" font-weight="bold" fill="#FFFFFF" text-anchor="middle">
        ${displayCount}
      </text>
    </svg>
  `.trim();

  return Buffer.from(svg, 'utf-8');
}

/**
 * Updates the Windows taskbar badge counter and flashes frame if needed.
 */
export function updateTaskbarBadge(mainWindow: BrowserWindow, count: number): void {
  if (mainWindow.isDestroyed()) return;

  if (count > 0) {
    try {
      const svgBuffer = createBadgeSvg(count);
      const badgeImage = nativeImage.createFromBuffer(svgBuffer, {
        width: 32,
        height: 32
      });

      mainWindow.setOverlayIcon(badgeImage, `${count} unread messages`);

      // Flash taskbar icon if window is not focused
      if (!mainWindow.isFocused()) {
        mainWindow.flashFrame(true);
      }
    } catch (err) {
      console.error('Failed to create overlay icon:', err);
    }
  } else {
    mainWindow.setOverlayIcon(null, '');
    mainWindow.flashFrame(false);
  }
}
