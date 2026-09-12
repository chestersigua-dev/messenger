import { app, BrowserWindow, session, ipcMain, nativeTheme } from 'electron';
import path from 'path';
import { setupAuthAndNavigationHandlers } from './auth';
import { setupMediaAndPermissions } from './media';
import { setupNotifications } from './notifications';
import { setupSystemTray, updateTrayToolTip, setIsQuitting } from './tray';
import { updateTaskbarBadge } from './badge';
import { setupShortcuts } from './shortcuts';
import { UnreadCountPayload } from '../types';

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
  const customSession = session.fromPartition(SESSION_PARTITION, { cache: true });

  // Custom User-Agent to ensure modern desktop features without mobile redirects
  const defaultUserAgent = customSession.getUserAgent();
  const desktopUserAgent = defaultUserAgent
    .replace(/Electron\/\S+\s/, '')
    .replace(/messenger-desktop\/\S+\s/, '');
  customSession.setUserAgent(desktopUserAgent);

  // Setup WebRTC and media permissions
  setupMediaAndPermissions(customSession);

  // Determine initial theme colors
  const isDark = nativeTheme.shouldUseDarkColors;
  const initialBackgroundColor = isDark ? '#18191a' : '#ffffff';

  mainWindow = new BrowserWindow({
    title: 'Messenger',
    width: 1200,
    height: 800,
    minWidth: 400,
    minHeight: 500,
    backgroundColor: initialBackgroundColor,
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

  // Setup global shortcuts
  setupShortcuts(mainWindow);

  // Handle unread message badge count IPC
  ipcMain.on('set-unread-count', (_event, payload: UnreadCountPayload) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const count = Math.max(0, payload.count || 0);
    updateTaskbarBadge(mainWindow, count);
    updateTrayToolTip(count);
  });

  // Listen to Windows system theme updates
  nativeTheme.on('updated', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const isDarkNow = nativeTheme.shouldUseDarkColors;
    mainWindow.setBackgroundColor(isDarkNow ? '#18191a' : '#ffffff');
    mainWindow.webContents.send('theme-changed', isDarkNow);
  });

  // Show window smoothly when content is ready
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    mainWindow?.focus();
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
