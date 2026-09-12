import { globalShortcut, BrowserWindow, app } from 'electron';
import { isNotificationsMuted, setNotificationsMuted } from './notifications';
import { getSettings, saveSettings } from './settings';
import { THEME_LIST, applyTheme } from './themes';

/**
 * Registers global and application shortcuts
 */
export function setupShortcuts(mainWindow: BrowserWindow): void {
  // Global shortcut to toggle Messenger visibility (Ctrl+Shift+M or Cmd+Shift+M)
  globalShortcut.register('CommandOrControl+Shift+M', () => {
    if (mainWindow.isDestroyed()) return;

    if (mainWindow.isVisible()) {
      if (mainWindow.isFocused()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // Global shortcut to quickly toggle mute notifications (Ctrl+Shift+N)
  globalShortcut.register('CommandOrControl+Shift+N', () => {
    const newMuted = !isNotificationsMuted();
    setNotificationsMuted(newMuted);
    saveSettings({ muteNotifications: newMuted });
  });

  // Global shortcut to toggle Always on Top (Ctrl+Shift+A)
  globalShortcut.register('CommandOrControl+Shift+A', () => {
    if (mainWindow.isDestroyed()) return;
    const settings = getSettings();
    const newAlwaysOnTop = !settings.alwaysOnTop;
    mainWindow.setAlwaysOnTop(newAlwaysOnTop);
    saveSettings({ alwaysOnTop: newAlwaysOnTop });
  });

  // Global shortcut to cycle themes (Ctrl+Shift+T)
  globalShortcut.register('CommandOrControl+Shift+T', () => {
    if (mainWindow.isDestroyed()) return;
    const settings = getSettings();
    const currentIndex = THEME_LIST.findIndex((t) => t.id === settings.theme);
    const nextIndex = (currentIndex + 1) % THEME_LIST.length;
    const nextTheme = THEME_LIST[nextIndex];
    saveSettings({ theme: nextTheme.id });
    applyTheme(mainWindow, nextTheme.id);
  });

  // Cleanup shortcuts when app is quitting
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });
}
