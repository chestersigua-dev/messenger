import { Menu, BrowserWindow, app, MenuItemConstructorOptions } from 'electron';
import { getSettings, saveSettings, onSettingsChange } from './settings';
import { THEME_LIST, applyTheme } from './themes';
import { isNotificationsMuted, setNotificationsMuted } from './notifications';

let updateMenuFn: (() => void) | null = null;

export function refreshAppMenu(): void {
  if (updateMenuFn) {
    updateMenuFn();
  }
}

export function setupApplicationMenu(mainWindow: BrowserWindow): void {
  const buildMenu = () => {
    const settings = getSettings();
    const currentTheme = settings.theme;

    const darkThemeItems: MenuItemConstructorOptions[] = THEME_LIST
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

    const lightThemeItems: MenuItemConstructorOptions[] = THEME_LIST
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

    const template: MenuItemConstructorOptions[] = [
      {
        label: '&File',
        submenu: [
          {
            label: 'Preferences...',
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
            accelerator: 'CmdOrControl+Shift+N',
            click: (item) => {
              setNotificationsMuted(item.checked);
              saveSettings({ muteNotifications: item.checked });
            }
          },
          { type: 'separator' },
          {
            label: 'Clear Cache && Reload',
            click: async () => {
              await mainWindow.webContents.session.clearCache();
              mainWindow.reload();
            }
          },
          {
            label: 'E&xit',
            accelerator: 'Alt+F4',
            click: () => {
              app.quit();
            }
          }
        ]
      },
      {
        label: '&Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' }
        ]
      },
      {
        label: '&Tabs',
        submenu: [
          {
            label: 'Personal Messenger',
            accelerator: 'CmdOrControl+1',
            click: () => {
              const { switchTab } = require('./main');
              switchTab('personal');
            }
          },
          {
            label: settings.pageInboxName || 'Page Inbox',
            accelerator: 'CmdOrControl+2',
            click: () => {
              const { switchTab } = require('./main');
              switchTab('page');
            }
          },
          {
            label: 'Switch Managed Page...',
            accelerator: 'CmdOrControl+Shift+P',
            click: () => {
              const { triggerPageChooser } = require('./main');
              triggerPageChooser();
            }
          },
          { type: 'separator' },
          {
            label: 'Enable Page Chat Tab',
            type: 'checkbox',
            checked: settings.enablePageInbox !== false,
            click: (item) => {
              saveSettings({ enablePageInbox: item.checked });
            }
          },
          {
            label: 'Pop out Page into Separate Window',
            click: () => {
              const { popoutPageWindow } = require('./main');
              popoutPageWindow();
            }
          },
          {
            label: 'Reset Page Session / Log Out...',
            click: async () => {
              const { resetPageSession } = require('./main');
              await resetPageSession();
            }
          }
        ]
      },
      {
        label: '&View',
        submenu: [
          {
            label: '&Themes',
            submenu: [
              { label: 'Dark Themes', enabled: false },
              ...darkThemeItems,
              { type: 'separator' },
              { label: 'Light Themes', enabled: false },
              ...lightThemeItems
            ]
          },
          { type: 'separator' },
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          {
            label: 'Zoom In',
            accelerator: 'CmdOrControl+=',
            click: () => {
              const s = getSettings();
              const next = Math.min(160, (s.fontSize || 100) + 10);
              saveSettings({ fontSize: next });
              mainWindow.webContents.setZoomFactor(next / 100);
              mainWindow.webContents.send('settings-changed', getSettings());
            }
          },
          {
            label: 'Zoom Out',
            accelerator: 'CmdOrControl+-',
            click: () => {
              const s = getSettings();
              const next = Math.max(70, (s.fontSize || 100) - 10);
              saveSettings({ fontSize: next });
              mainWindow.webContents.setZoomFactor(next / 100);
              mainWindow.webContents.send('settings-changed', getSettings());
            }
          },
          {
            label: 'Reset Zoom',
            accelerator: 'CmdOrControl+0',
            click: () => {
              saveSettings({ fontSize: 100 });
              mainWindow.webContents.setZoomFactor(1.0);
              mainWindow.webContents.send('settings-changed', getSettings());
            }
          },
          { type: 'separator' },
          { role: 'togglefullscreen' }
        ]
      },
      {
        label: '&Window',
        submenu: [
          {
            label: 'Always on Top',
            type: 'checkbox',
            checked: settings.alwaysOnTop,
            accelerator: 'CmdOrControl+Shift+A',
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
          { type: 'separator' },
          { role: 'minimize' },
          { role: 'close' }
        ]
      }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  };

  updateMenuFn = buildMenu;
  buildMenu();

  onSettingsChange(() => {
    buildMenu();
  });
}
