import { app, BrowserWindow, session, ipcMain, nativeTheme, shell } from 'electron';
import path from 'path';
import { setupAuthAndNavigationHandlers } from './auth';
import { setupMediaAndPermissions } from './media';
import { setupNotifications, setNotificationsMuted } from './notifications';
import { setupSystemTray, updateTrayToolTip, setIsQuitting } from './tray';
import { updateTaskbarBadge } from './badge';
import { setupShortcuts } from './shortcuts';
import { setupApplicationMenu } from './menu';
import { loadSettings, getSettings, saveSettings } from './settings';
import { applyTheme, getTheme, THEME_LIST } from './themes';
import { UnreadCountPayload, AppSettings } from '../types';

// Persistent partition for storing cookies, session tokens, and local cache
const SESSION_PARTITION = 'persist:messenger_session';
const TARGET_URL = 'https://www.messenger.com/';

// Optimize performance and hardware acceleration
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
// Prevent audio interruptions when backgrounded
app.commandLine.appendSwitch('disable-background-timer-throttling');

let mainWindow: BrowserWindow | null = null;

// Enforce single instance lock
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Focus existing window if a second instance attempts to launch
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(initApp);
}

async function initApp(): Promise<void> {
  const settings = loadSettings();
  setNotificationsMuted(settings.muteNotifications);

  const customSession = session.fromPartition(SESSION_PARTITION, { cache: true });

  // Custom User-Agent to ensure modern desktop features without mobile redirects
  const defaultUserAgent = customSession.getUserAgent();
  const desktopUserAgent = defaultUserAgent
    .replace(/Electron\/\S+\s/, '')
    .replace(/messenger-desktop\/\S+\s/, '');
  customSession.setUserAgent(desktopUserAgent);

  // Setup WebRTC and media permissions
  setupMediaAndPermissions(customSession);

  // Determine initial theme colors from settings
  const currentTheme = getTheme(settings.theme);
  const initialBackgroundColor = currentTheme.previewColors.bg;

  mainWindow = new BrowserWindow({
    title: 'Messenger',
    width: 1200,
    height: 800,
    minWidth: 400,
    minHeight: 500,
    backgroundColor: initialBackgroundColor,
    alwaysOnTop: settings.alwaysOnTop,
    icon: path.join(__dirname, '../../assets/icon.ico'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      partition: SESSION_PARTITION,
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // required for full preload integration
      backgroundThrottling: false, // critical for uninterrupted audio/video calls
      spellcheck: true
    }
  });

  // Setup OAuth and navigation safeguards
  setupAuthAndNavigationHandlers(mainWindow, SESSION_PARTITION);

  // Setup Windows native notifications
  setupNotifications(mainWindow);

  // Setup System Tray and minimize-to-tray handling
  setupSystemTray(mainWindow);

  // Setup Windows Application Menu
  setupApplicationMenu(mainWindow);

  // Setup global shortcuts
  setupShortcuts(mainWindow);

  // Handle minimize to tray behavior
  mainWindow.on('minimize', () => {
    const currentSettings = getSettings();
    if (currentSettings.minimizeToTray) {
      mainWindow?.hide();
    }
  });

  // Handle unread message badge count IPC
  ipcMain.on('set-unread-count', (_event, payload: UnreadCountPayload) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const count = Math.max(0, payload.count || 0);
    updateTaskbarBadge(mainWindow, count);
    updateTrayToolTip(count);
  });

  // Handle open external URL
  ipcMain.on('open-external-url', (_event, url: string) => {
    if (url) {
      shell.openExternal(url).catch((err) => {
        console.error('Failed to open external url:', url, err);
      });
    }
  });

  // Handle toggle fullscreen
  ipcMain.on('toggle-fullscreen', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    }
  });

  // Handle open preferences modal
  ipcMain.on('open-preferences-modal', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('open-preferences');
    }
  });

  // IPC handlers for Settings and Themes
  ipcMain.handle('get-settings', () => {
    return getSettings();
  });

  ipcMain.handle('update-settings', async (_event, partial: Partial<AppSettings>) => {
    const updated = saveSettings(partial);
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (partial.theme) {
        await applyTheme(mainWindow, partial.theme);
      }
      if (typeof partial.alwaysOnTop === 'boolean') {
        mainWindow.setAlwaysOnTop(partial.alwaysOnTop);
      }
      if (typeof partial.muteNotifications === 'boolean') {
        setNotificationsMuted(partial.muteNotifications);
      }
      mainWindow.webContents.send('settings-changed', updated);
    }
    return updated;
  });

  ipcMain.handle('get-themes', () => {
    return THEME_LIST;
  });

  // Apply active theme once DOM is ready and when page finishes loading
  mainWindow.webContents.on('dom-ready', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const s = getSettings();
      applyTheme(mainWindow, s.theme);
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const s = getSettings();
      applyTheme(mainWindow, s.theme);
    }
  });

  // Listen to Windows system theme updates
  nativeTheme.on('updated', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const s = getSettings();
    const theme = getTheme(s.theme);
    mainWindow.setBackgroundColor(theme.previewColors.bg);
    mainWindow.webContents.send('theme-changed', theme.category === 'dark');
  });

  // Show window smoothly when content is ready
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    mainWindow?.focus();
    const s = getSettings();
    if (mainWindow) {
      applyTheme(mainWindow, s.theme);
    }
  });

  // Load Messenger web client
  await mainWindow.loadURL(TARGET_URL);
}

app.on('activate', () => {
  if (mainWindow === null) {
    initApp();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('before-quit', () => {
  setIsQuitting(true);
});
