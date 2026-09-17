import { Notification, BrowserWindow, ipcMain, app } from 'electron';
import path from 'path';
import { NotificationPayload, AccountType } from '../types';
import { getSettings } from './settings';

let notificationsMuted = false;
let pageNotificationsMuted = false;

export function isNotificationsMuted(): boolean {
  return notificationsMuted;
}

export function setNotificationsMuted(muted: boolean): void {
  notificationsMuted = muted;
}

export function isPageNotificationsMuted(): boolean {
  return pageNotificationsMuted;
}

export function setPageNotificationsMuted(muted: boolean): void {
  pageNotificationsMuted = muted;
}

export interface NotificationHandlers {
  onSelectTab?: (account: AccountType) => void;
  onNavigateThread?: (account: AccountType, urlOrThreadId: string) => void;
  sendToView?: (account: AccountType, channel: string, ...args: unknown[]) => void;
}

/**
 * Initializes notification IPC listeners and sets Windows AppUserModelId.
 */
export function setupNotifications(
  mainWindow: BrowserWindow,
  handlers?: NotificationHandlers
): void {
  // Ensure Windows 10 / 11 associates notifications with the Messenger app ID
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.messenger.desktop');
  }

  ipcMain.on('show-notification', (_event, payload: NotificationPayload) => {
    const account: AccountType = payload.account || 'personal';

    if (account === 'page') {
      if (pageNotificationsMuted) return;
    } else {
      if (notificationsMuted) return;
    }

    if (!Notification.isSupported()) {
      return;
    }

    const settings = getSettings();
    const iconPath = path.join(__dirname, '../../assets/icon.ico');

    let displayTitle = payload.title || 'Messenger';
    if (account === 'page') {
      const pageLabel = settings.pageInboxName || 'Page Inbox';
      displayTitle = payload.title ? `[${pageLabel}] ${payload.title}` : `[${pageLabel}] New Message`;
    }

    const notification = new Notification({
      title: displayTitle,
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

      // Switch to the relevant tab
      if (handlers?.onSelectTab) {
        handlers.onSelectTab(account);
      }

      // If notification contains thread metadata or target URL, navigate in target view
      const targetUrl = payload.data?.url as string | undefined;
      const threadId = payload.data?.threadId as string | undefined;

      if (handlers?.onNavigateThread) {
        if (targetUrl) {
          handlers.onNavigateThread(account, targetUrl);
        } else if (threadId) {
          const url = account === 'page'
            ? `https://business.facebook.com/latest/inbox/messenger?selected_item_id=${threadId}`
            : `https://www.messenger.com/t/${threadId}`;
          handlers.onNavigateThread(account, url);
        }
      }

      if (handlers?.sendToView) {
        handlers.sendToView(account, 'notification-clicked', {
          id: payload.id,
          data: payload.data
        });
      } else {
        mainWindow.webContents.send('notification-clicked', {
          id: payload.id,
          data: payload.data
        });
      }
    });

    notification.show();
  });
}
