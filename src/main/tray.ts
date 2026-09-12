import { Tray, Menu, BrowserWindow, app, nativeImage } from 'electron';
import path from 'path';
import { isNotificationsMuted, setNotificationsMuted } from './notifications';

let tray: Tray | null = null;
let isQuitting = false;

export function getIsQuitting(): boolean {
  return isQuitting;
}

export function setIsQuitting(val: boolean): void {
  isQuitting = val;
}

/**
 * Initializes the system tray and hooks the main window close event.
 */
export function setupSystemTray(mainWindow: BrowserWindow): Tray {
  const iconPath = path.join(__dirname, '../../assets/tray.ico');
  const trayIcon = nativeImage.createFromPath(iconPath);

  tray = new Tray(trayIcon.isEmpty() ? nativeImage.createEmpty() : trayIcon);
  tray.setToolTip('Messenger');

  // Toggle window on left click
  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      if (mainWindow.isFocused()) {
        mainWindow.hide();
      } else {
        mainWindow.focus();
      }
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  const updateContextMenu = () => {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Open Messenger',
        click: () => {
          mainWindow.show();
          mainWindow.focus();
        }
      },
      { type: 'separator' },
      {
        label: 'Mute Notifications',
        type: 'checkbox',
        checked: isNotificationsMuted(),
        click: (item) => {
          setNotificationsMuted(item.checked);
        }
      },
      {
        label: 'Reload Messenger',
        click: () => {
          mainWindow.reload();
        }
      },
      {
        label: 'Clear Cache & Reload',
        click: async () => {
          await mainWindow.webContents.session.clearCache();
          mainWindow.reload();
        }
      },
      { type: 'separator' },
      {
        label: 'Quit Messenger',
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ]);

    tray?.setContextMenu(contextMenu);
  };

  updateContextMenu();

  // Intercept window close event to minimize to tray instead
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();

      // On Windows, display a hint on first minimize
      if (process.platform === 'win32' && tray) {
        tray.displayBalloon?.({
          title: 'Messenger is still running',
          content: 'Messenger is minimized to the system tray to keep delivering calls and messages.'
        });
      }
    }
  });

  return tray;
}

export function updateTrayToolTip(unreadCount: number): void {
  if (!tray) return;

  if (unreadCount > 0) {
    tray.setToolTip(`Messenger (${unreadCount} unread)`);
  } else {
    tray.setToolTip('Messenger');
  }
}
