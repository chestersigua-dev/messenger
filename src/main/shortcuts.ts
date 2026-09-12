import { globalShortcut, BrowserWindow, app } from 'electron';
import { isNotificationsMuted, setNotificationsMuted } from './notifications';

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
    setNotificationsMuted(!isNotificationsMuted());
  });

  // Cleanup shortcuts when app is quitting
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });
}
