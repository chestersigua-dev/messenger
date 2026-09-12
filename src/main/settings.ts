import { app, nativeTheme } from 'electron';
import path from 'path';
import fs from 'fs';
import { AppSettings } from '../types';

let currentSettings: AppSettings | null = null;
const changeListeners: Array<(newSettings: AppSettings, prevSettings: AppSettings) => void> = [];

function getDefaultSettings(): AppSettings {
  const isDark = nativeTheme.shouldUseDarkColors;
  return {
    muteNotifications: false,
    minimizeToTray: true,
    alwaysOnTop: false,
    startMinimized: false,
    autoLaunch: false,
    theme: isDark ? 'dark-midnight' : 'light-clean',
    hardwareAcceleration: true
  };
}

function getSettingsFilePath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function loadSettings(): AppSettings {
  if (currentSettings) {
    return currentSettings;
  }

  const defaults = getDefaultSettings();

  try {
    const filePath = getSettingsFilePath();
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(data);
      currentSettings = { ...defaults, ...parsed };
      return currentSettings as AppSettings;
    }
  } catch (err) {
    console.error('Failed to read settings from disk, using defaults:', err);
  }

  currentSettings = defaults;
  saveSettings(currentSettings);
  return currentSettings;
}

export function getSettings(): AppSettings {
  if (!currentSettings) {
    return loadSettings();
  }
  return currentSettings;
}

export function saveSettings(newSettings: Partial<AppSettings>): AppSettings {
  const prevSettings = getSettings();
  const updated: AppSettings = { ...prevSettings, ...newSettings };
  currentSettings = updated;

  try {
    const filePath = getSettingsFilePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save settings to disk:', err);
  }

  // Notify listeners
  for (const listener of changeListeners) {
    try {
      listener(updated, prevSettings);
    } catch (err) {
      console.error('Error in settings change listener:', err);
    }
  }

  return updated;
}

export function onSettingsChange(
  listener: (newSettings: AppSettings, prevSettings: AppSettings) => void
): () => void {
  changeListeners.push(listener);
  return () => {
    const index = changeListeners.indexOf(listener);
    if (index !== -1) {
      changeListeners.splice(index, 1);
    }
  };
}
