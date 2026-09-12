import { Notification, BrowserWindow, ipcMain, app } from 'electron';
import path from 'path';
import { NotificationPayload } from '../types';

let notificationsMuted = false;

export function isNotificationsMuted(): boolean {
  return notificationsMuted;
}

export function setNotificationsMuted(muted: boolean): void {
  notificationsMuted = muted;
}

/**
 * Initializes notification IPC listeners and sets Windows AppUserModelId.
 */
export function setupNotifications(mainWindow: BrowserWindow): void {
  // Ensure Windows 10 / 11 associates notifications with the Messenger app ID
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.messenger.desktop');
  }

  ipcMain.on('show-notification', (_event, payload: NotificationPayload) => {
    if (notificationsMuted) {
      return;
    }

    if (!Notification.isSupported()) {
      return;
    }

    const iconPath = path.join(__dirname, '../../assets/icon.ico');

    const notification = new Notification({
      title: payload.title || 'Messenger',
      body: payload.body || 'You received a new message',
      icon: iconPath,
      silent: false
    });

    notification.on('click', () => {
      if (mainWindow.isDestroyed()) return;

      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }

      if (!mainWindow.isVisible()) {
        mainWindow.show();
      }

      mainWindow.focus();

      // If notification contains thread metadata or target URL, notify renderer/preload
      if (payload.data?.url) {
        mainWindow.loadURL(payload.data.url as string);
      } else if (payload.data?.threadId) {
        mainWindow.loadURL(`https://www.messenger.com/t/${payload.data.threadId}`);
      }

      mainWindow.webContents.send('notification-clicked', {
        id: payload.id,
        data: payload.data
      });
    });

    notification.show();
  });
}
