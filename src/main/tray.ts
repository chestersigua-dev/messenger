import { Tray, Menu, BrowserWindow, app, nativeImage, MenuItemConstructorOptions } from 'electron';
import path from 'path';
import { isNotificationsMuted, setNotificationsMuted } from './notifications';
import { getSettings, saveSettings, onSettingsChange } from './settings';
import { THEME_LIST, applyTheme } from './themes';

let tray: Tray | null = null;
let isQuitting = false;
let updateMenuFn: (() => void) | null = null;

export function getIsQuitting(): boolean {
  return isQuitting;
}

export function setIsQuitting(val: boolean): void {
  isQuitting = val;
}

export function refreshTrayMenu(): void {
  if (updateMenuFn) {
    updateMenuFn();
  }
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
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    } else {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  const updateContextMenu = () => {
    const settings = getSettings();
    const currentTheme = settings.theme;

    const darkThemes: MenuItemConstructorOptions[] = THEME_LIST
      .filter((t) => t.category === 'dark')
      .map((t) => ({
        label: t.name,
        type: 'radio' as const,
        checked: currentTheme === t.id,
        click: () => {
          saveSettings({ theme: t.id });
          applyTheme(mainWindow, t.id);
        }
      }));

    const lightThemes: MenuItemConstructorOptions[] = THEME_LIST
      .filter((t) => t.category === 'light')
      .map((t) => ({
        label: t.name,
        type: 'radio' as const,
        checked: currentTheme === t.id,
        click: () => {
          saveSettings({ theme: t.id });
          applyTheme(mainWindow, t.id);
        }
      }));

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Open Messenger',
        click: () => {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        }
      },
      { type: 'separator' },
      {
        label: 'Always on Top',
        type: 'checkbox',
        checked: settings.alwaysOnTop,
        click: (item) => {
          saveSettings({ alwaysOnTop: item.checked });
          mainWindow.setAlwaysOnTop(item.checked);
        }
      },
      {
        label: 'Minimize to Tray',
        type: 'checkbox',
        checked: settings.minimizeToTray,
        click: (item) => {
          saveSettings({ minimizeToTray: item.checked });
        }
      },
      {
        label: 'Themes',
        submenu: [
          { label: 'Dark Themes', enabled: false },
          ...darkThemes,
          { type: 'separator' },
          { label: 'Light Themes', enabled: false },
          ...lightThemes
        ]
      },
      {
        label: 'Preferences / Theme Settings...',
        accelerator: 'CmdOrCtrl+,',
        click: () => {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('open-preferences');
        }
      },
      { type: 'separator' },
      {
        label: 'Mute Notifications',
        type: 'checkbox',
        checked: isNotificationsMuted(),
        click: (item) => {
          setNotificationsMuted(item.checked);
          saveSettings({ muteNotifications: item.checked });
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

  updateMenuFn = updateContextMenu;
  updateContextMenu();

  // Listen to external settings changes
  onSettingsChange(() => {
    updateContextMenu();
  });

  // Intercept window close event to hide to tray
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();

      // On Windows, display a hint on first minimize
      if (process.platform === 'win32' && tray) {
        tray.displayBalloon?.({
          title: 'Messenger is still running',
          content: 'Messenger is running in the system tray to keep delivering calls and messages.'
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
