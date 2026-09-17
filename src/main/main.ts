import { app, BrowserWindow, WebContentsView, session, ipcMain, nativeTheme, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { setupAuthAndNavigationHandlers } from './auth';
import { setupMediaAndPermissions } from './media';
import { setupNotifications, setNotificationsMuted, setPageNotificationsMuted } from './notifications';
import { setupSystemTray, updateTrayToolTip, setIsQuitting } from './tray';
import { updateTaskbarBadge } from './badge';
import { setupShortcuts } from './shortcuts';
import { setupApplicationMenu } from './menu';
import { loadSettings, getSettings, saveSettings } from './settings';
import { applyTheme, getTheme, THEME_LIST } from './themes';
import { UnreadCountPayload, AppSettings, AccountType } from '../types';

// Persistent partitions for storing cookies, session tokens, and cache
const SESSION_PARTITION = 'persist:messenger_session';
const PAGE_SESSION_PARTITION = 'persist:messenger_page_session';
const TARGET_URL = 'https://www.messenger.com/';
const TAB_BAR_HEIGHT = 40;

// Optimize performance and hardware acceleration
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
// Prevent audio interruptions when backgrounded
app.commandLine.appendSwitch('disable-background-timer-throttling');

let mainWindow: BrowserWindow | null = null;
let tabBarView: WebContentsView | null = null;
let personalView: WebContentsView | null = null;
let pageView: WebContentsView | null = null;
let popoutPageWin: BrowserWindow | null = null;

let activeTab: AccountType = 'personal';
const unreadCounts = { personal: 0, page: 0 };

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

function getTabBarHtmlPath(): string {
  const candidates = [
    path.join(app.getAppPath(), 'assets/tabbar/tabbar.html'),
    path.join(__dirname, '../../assets/tabbar/tabbar.html'),
    path.join(__dirname, '../tabbar/tabbar.html'),
    path.join(process.cwd(), 'assets/tabbar/tabbar.html')
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {}
  }

  return candidates[0];
}

function updateViewBounds(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!tabBarView || !personalView || !pageView) return;

  const bounds = mainWindow.getContentBounds();
  const settings = getSettings();
  const showTabBar = settings.enablePageInbox !== false;

  if (showTabBar) {
    tabBarView.setVisible(true);
    tabBarView.setBounds({ x: 0, y: 0, width: bounds.width, height: TAB_BAR_HEIGHT });

    const contentBounds = {
      x: 0,
      y: TAB_BAR_HEIGHT,
      width: bounds.width,
      height: Math.max(0, bounds.height - TAB_BAR_HEIGHT)
    };

    personalView.setBounds(contentBounds);
    pageView.setBounds(contentBounds);

    personalView.setVisible(activeTab === 'personal');
    pageView.setVisible(activeTab === 'page');
  } else {
    tabBarView.setVisible(false);
    const contentBounds = { x: 0, y: 0, width: bounds.width, height: bounds.height };
    personalView.setBounds(contentBounds);
    pageView.setBounds(contentBounds);
    personalView.setVisible(true);
    pageView.setVisible(false);
  }
}

export function switchTab(tab: AccountType): void {
  activeTab = tab;
  updateViewBounds();

  if (tab === 'page') {
    pageView?.webContents.focus();
  } else {
    personalView?.webContents.focus();
  }

  if (tabBarView && !tabBarView.webContents.isDestroyed()) {
    tabBarView.webContents.send('tab-switched', tab);
  }
}

export function getActiveTab(): AccountType {
  return activeTab;
}

export function reloadActiveTab(): void {
  if (activeTab === 'page') {
    pageView?.webContents.reload();
  } else {
    personalView?.webContents.reload();
  }
}

export async function resetPageSession(): Promise<boolean> {
  try {
    const pageSession = session.fromPartition(PAGE_SESSION_PARTITION);
    await pageSession.clearStorageData();
    await pageSession.clearCache();
    const settings = getSettings();
    if (pageView && !pageView.webContents.isDestroyed()) {
      await pageView.webContents.loadURL(settings.pageInboxUrl || 'https://business.facebook.com/latest/inbox');
    }
    unreadCounts.page = 0;
    updateBadgesAndTaskbar();
    return true;
  } catch (err) {
    console.error('Failed to reset page session:', err);
    return false;
  }
}

export function popoutPageWindow(): void {
  if (popoutPageWin && !popoutPageWin.isDestroyed()) {
    popoutPageWin.focus();
    return;
  }

  const settings = getSettings();
  const currentTheme = getTheme(settings.theme);

  popoutPageWin = new BrowserWindow({
    title: settings.pageInboxName || 'Page Inbox',
    width: 1100,
    height: 750,
    backgroundColor: currentTheme.previewColors.bg,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '../../assets/icon.ico'),
    webPreferences: {
      partition: PAGE_SESSION_PARTITION,
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: true,
      additionalArguments: ['--account-type=page']
    }
  });

  setupAuthAndNavigationHandlers(popoutPageWin, PAGE_SESSION_PARTITION);
  popoutPageWin.loadURL(settings.pageInboxUrl || 'https://business.facebook.com/latest/inbox');

  popoutPageWin.on('closed', () => {
    popoutPageWin = null;
  });
}

function updateBadgesAndTaskbar(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (tabBarView && !tabBarView.webContents.isDestroyed()) {
    tabBarView.webContents.send('update-tab-badges', unreadCounts);
  }

  const settings = getSettings();
  const totalCount = unreadCounts.personal + (settings.includePageInTaskbarBadge !== false ? unreadCounts.page : 0);

  updateTaskbarBadge(mainWindow, totalCount);

  if (unreadCounts.personal > 0 && unreadCounts.page > 0) {
    updateTrayToolTip(totalCount, `${unreadCounts.personal} Personal, ${unreadCounts.page} Page`);
  } else if (unreadCounts.page > 0) {
    updateTrayToolTip(unreadCounts.page, `${unreadCounts.page} Page`);
  } else {
    updateTrayToolTip(unreadCounts.personal);
  }
}

function setupUserAgent(s: Electron.Session): void {
  const defaultUserAgent = s.getUserAgent();
  const desktopUserAgent = defaultUserAgent
    .replace(/Electron\/\S+\s/, '')
    .replace(/messenger-desktop\/\S+\s/, '');
  s.setUserAgent(desktopUserAgent);
}

async function initApp(): Promise<void> {
  const settings = loadSettings();
  setNotificationsMuted(settings.muteNotifications);
  setPageNotificationsMuted(settings.mutePageNotifications);

  // Determine initial theme
  const currentTheme = getTheme(settings.theme);
  nativeTheme.themeSource = currentTheme.category === 'dark' ? 'dark' : 'light';
  const initialBackgroundColor = currentTheme.previewColors.bg;

  // Setup sessions
  const personalSession = session.fromPartition(SESSION_PARTITION, { cache: true });
  setupUserAgent(personalSession);
  setupMediaAndPermissions(personalSession);

  const pageSession = session.fromPartition(PAGE_SESSION_PARTITION, { cache: true });
  setupUserAgent(pageSession);
  setupMediaAndPermissions(pageSession);

  mainWindow = new BrowserWindow({
    title: 'Messenger',
    width: 1200,
    height: 800,
    minWidth: 450,
    minHeight: 500,
    backgroundColor: initialBackgroundColor,
    alwaysOnTop: settings.alwaysOnTop,
    icon: path.join(__dirname, '../../assets/icon.ico'),
    autoHideMenuBar: true,
    show: false
  });

  // 1. REGISTER ALL IPC HANDLERS FIRST
  ipcMain.handle('get-tabbar-state', () => {
    return {
      activeTab,
      settings: getSettings(),
      counts: unreadCounts,
      themes: THEME_LIST
    };
  });

  ipcMain.on('switch-tab', (_event, tab: AccountType) => {
    switchTab(tab);
  });

  ipcMain.on('reload-active-tab', () => {
    reloadActiveTab();
  });

  ipcMain.handle('reset-page-session', async () => {
    return await resetPageSession();
  });

  ipcMain.on('popout-page-window', () => {
    popoutPageWindow();
  });

  ipcMain.on('open-external-url', (_event, url: string) => {
    if (url) {
      shell.openExternal(url).catch((err) => {
        console.error('Failed to open external url:', url, err);
      });
    }
  });

  ipcMain.on('toggle-fullscreen', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    }
  });

  ipcMain.on('open-preferences-modal', () => {
    const currentView = activeTab === 'page' ? pageView : personalView;
    if (currentView && !currentView.webContents.isDestroyed()) {
      currentView.webContents.send('open-preferences');
    } else if (personalView && !personalView.webContents.isDestroyed()) {
      personalView.webContents.send('open-preferences');
    }
  });

  ipcMain.on('open-page-chooser-modal', () => {
    if (activeTab !== 'page') {
      switchTab('page');
    }
    if (pageView && !pageView.webContents.isDestroyed()) {
      pageView.webContents.send('open-page-chooser', { isPostLogin: false });
    }
  });

  ipcMain.handle('get-settings', () => {
    return getSettings();
  });

  ipcMain.handle('update-settings', async (_event, partial: Partial<AppSettings>) => {
    const updated = saveSettings(partial);
    if (mainWindow && !mainWindow.isDestroyed()) {
      const views = [tabBarView, personalView, pageView].filter((v): v is WebContentsView => v !== null);

      if (partial.theme) {
        const viewsToTheme = [
          tabBarView ? { webContents: tabBarView.webContents, type: 'tabbar' as const } : null,
          personalView ? { webContents: personalView.webContents, type: 'personal' as const } : null,
          pageView ? { webContents: pageView.webContents, type: 'page' as const } : null
        ].filter((v): v is NonNullable<typeof v> => v !== null);
        await applyTheme(mainWindow, partial.theme, viewsToTheme);
      }
      if (typeof partial.alwaysOnTop === 'boolean') {
        mainWindow.setAlwaysOnTop(partial.alwaysOnTop);
      }
      if (typeof partial.muteNotifications === 'boolean') {
        setNotificationsMuted(partial.muteNotifications);
      }
      if (typeof partial.mutePageNotifications === 'boolean') {
        setPageNotificationsMuted(partial.mutePageNotifications);
      }
      if (typeof partial.fontSize === 'number') {
        const factor = Math.min(160, Math.max(70, partial.fontSize)) / 100;
        personalView?.webContents.setZoomFactor(factor);
        pageView?.webContents.setZoomFactor(factor);
      }
      if (typeof partial.enablePageInbox === 'boolean') {
        updateViewBounds();
      }
      if (partial.pageInboxUrl && pageView) {
        pageView.webContents.loadURL(partial.pageInboxUrl);
      }

      updateBadgesAndTaskbar();

      views.forEach((v) => {
        if (!v.webContents.isDestroyed()) {
          v.webContents.send('settings-changed', updated);
        }
      });
    }
    return updated;
  });

  ipcMain.handle('get-themes', () => {
    return THEME_LIST;
  });

  ipcMain.on('set-unread-count', (_event, payload: UnreadCountPayload) => {
    const account: AccountType = payload.account || 'personal';
    const count = Math.max(0, payload.count || 0);

    if (account === 'page') {
      unreadCounts.page = count;
    } else {
      unreadCounts.personal = count;
    }

    updateBadgesAndTaskbar();
  });

  // 2. CREATE AND ATTACH VIEWS
  tabBarView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, '../preload/tabbar-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });
  mainWindow.contentView.addChildView(tabBarView);

  personalView = new WebContentsView({
    webPreferences: {
      partition: SESSION_PARTITION,
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: true,
      additionalArguments: ['--account-type=personal']
    }
  });
  mainWindow.contentView.addChildView(personalView);
  setupAuthAndNavigationHandlers(personalView, SESSION_PARTITION, mainWindow);

  pageView = new WebContentsView({
    webPreferences: {
      partition: PAGE_SESSION_PARTITION,
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: true,
      additionalArguments: ['--account-type=page']
    }
  });
  mainWindow.contentView.addChildView(pageView);
  setupAuthAndNavigationHandlers(pageView, PAGE_SESSION_PARTITION, mainWindow);

  // Detect when user logs in and automatically ask which page to manage
  let wasOnPageLogin = false;
  pageView.webContents.on('did-navigate', (_event, url) => {
    const isLoginUrl =
      url.includes('/login') ||
      url.includes('loginpage') ||
      url.includes('/checkpoint') ||
      url.includes('two_step_verification');

    if (isLoginUrl) {
      wasOnPageLogin = true;
    } else if (wasOnPageLogin) {
      wasOnPageLogin = false;
      const s = getSettings();
      if (s.askPageOnLogin !== false) {
        setTimeout(() => {
          if (pageView && !pageView.webContents.isDestroyed()) {
            pageView.webContents.send('open-page-chooser', { isPostLogin: true });
          }
        }, 1500);
      }
    }
  });

  // Setup Notifications
  setupNotifications(mainWindow, {
    onSelectTab: (account: AccountType) => {
      switchTab(account);
    },
    onNavigateThread: (account: AccountType, url: string) => {
      const targetView = account === 'page' ? pageView : personalView;
      targetView?.webContents.loadURL(url);
    },
    sendToView: (account: AccountType, channel: string, ...args: unknown[]) => {
      const targetView = account === 'page' ? pageView : personalView;
      targetView?.webContents.send(channel, ...args);
    }
  });

  // Setup System Tray
  setupSystemTray(mainWindow);

  // Setup Application Menu
  setupApplicationMenu(mainWindow);

  // Setup Global Shortcuts
  setupShortcuts(mainWindow);

  // Handle minimize to tray behavior
  mainWindow.on('minimize', () => {
    const currentSettings = getSettings();
    if (currentSettings.minimizeToTray) {
      mainWindow?.hide();
    }
  });

  // Resize and window state handlers
  mainWindow.on('resize', updateViewBounds);
  mainWindow.on('maximize', updateViewBounds);
  mainWindow.on('unmaximize', updateViewBounds);
  mainWindow.on('restore', updateViewBounds);

  // Apply theme and zoom when DOM is ready
  const applyInitialThemeToView = (view: WebContentsView, type: 'personal' | 'page') => {
    view.webContents.on('dom-ready', () => {
      const s = getSettings();
      const factor = Math.min(160, Math.max(70, s.fontSize || 100)) / 100;
      view.webContents.setZoomFactor(factor);
      if (mainWindow) {
        applyTheme(mainWindow, s.theme, [{ webContents: view.webContents, type }]);
      }
    });
  };

  applyInitialThemeToView(personalView, 'personal');
  applyInitialThemeToView(pageView, 'page');

  // Listen to Windows system theme updates
  nativeTheme.on('updated', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const s = getSettings();
    const theme = getTheme(s.theme);
    nativeTheme.themeSource = theme.category === 'dark' ? 'dark' : 'light';
    mainWindow.setBackgroundColor(theme.previewColors.bg);
    const viewsToTheme = [
      tabBarView ? { webContents: tabBarView.webContents, type: 'tabbar' as const } : null,
      personalView ? { webContents: personalView.webContents, type: 'personal' as const } : null,
      pageView ? { webContents: pageView.webContents, type: 'page' as const } : null
    ].filter((v): v is NonNullable<typeof v> => v !== null);
    applyTheme(mainWindow, s.theme, viewsToTheme);
  });

  // 3. IMMEDIATELY LAYOUT AND SHOW WINDOW
  updateViewBounds();

  if (!settings.startMinimized) {
    mainWindow.show();
    mainWindow.focus();
  }

  const initialViewsToTheme = [
    tabBarView ? { webContents: tabBarView.webContents, type: 'tabbar' as const } : null,
    personalView ? { webContents: personalView.webContents, type: 'personal' as const } : null,
    pageView ? { webContents: pageView.webContents, type: 'page' as const } : null
  ].filter((v): v is NonNullable<typeof v> => v !== null);
  applyTheme(mainWindow, settings.theme, initialViewsToTheme);

  // 4. LOAD PAGES
  const tabbarHtmlPath = getTabBarHtmlPath();
  tabBarView.webContents.loadFile(tabbarHtmlPath).catch((err) => {
    console.error('Failed to load tabbar HTML:', err);
  });

  personalView.webContents.loadURL(TARGET_URL).catch((err) => {
    console.error('Failed to load Messenger personal URL:', err);
  });

  pageView.webContents.loadURL(settings.pageInboxUrl || 'https://business.facebook.com/latest/inbox').catch((err) => {
    console.error('Failed to load Page Inbox URL:', err);
  });
}

export function applyAppTheme(themeId: import('../types').ThemeId): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const viewsToTheme = [
    tabBarView ? { webContents: tabBarView.webContents, type: 'tabbar' as const } : null,
    personalView ? { webContents: personalView.webContents, type: 'personal' as const } : null,
    pageView ? { webContents: pageView.webContents, type: 'page' as const } : null
  ].filter((v): v is NonNullable<typeof v> => v !== null);
  applyTheme(mainWindow, themeId, viewsToTheme);
}

export function triggerPageChooser(): void {
  if (activeTab !== 'page') {
    switchTab('page');
  }
  if (pageView && !pageView.webContents.isDestroyed()) {
    pageView.webContents.send('open-page-chooser', { isPostLogin: false });
  }
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
