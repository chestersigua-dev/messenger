import { contextBridge, ipcRenderer } from 'electron';
import { AccountType, AppSettings, ThemeDefinition } from '../types';

export interface TabBarAPI {
  switchTab: (tab: AccountType) => void;
  reloadActiveTab: () => void;
  openPreferences: () => void;
  openPageChooser: () => void;
  popoutPageWindow: () => void;
  getInitialState: () => Promise<{
    activeTab: AccountType;
    settings: AppSettings;
    counts: { personal: number; page: number };
    themes: ThemeDefinition[];
  }>;
  onTabSwitched: (callback: (tab: AccountType) => void) => () => void;
  onUpdateBadges: (callback: (counts: { personal: number; page: number }) => void) => () => void;
  onThemeChanged: (callback: (theme: ThemeDefinition) => void) => () => void;
  onSettingsChanged: (callback: (settings: AppSettings) => void) => () => void;
}

const tabbarAPI: TabBarAPI = {
  switchTab: (tab: AccountType) => {
    ipcRenderer.send('switch-tab', tab);
  },
  reloadActiveTab: () => {
    ipcRenderer.send('reload-active-tab');
  },
  openPreferences: () => {
    ipcRenderer.send('open-preferences-modal');
  },
  openPageChooser: () => {
    ipcRenderer.send('open-page-chooser-modal');
  },
  popoutPageWindow: () => {
    ipcRenderer.send('popout-page-window');
  },
  getInitialState: () => {
    return ipcRenderer.invoke('get-tabbar-state');
  },
  onTabSwitched: (callback: (tab: AccountType) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, tab: AccountType) => callback(tab);
    ipcRenderer.on('tab-switched', handler);
    return () => {
      ipcRenderer.removeListener('tab-switched', handler);
    };
  },
  onUpdateBadges: (callback: (counts: { personal: number; page: number }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, counts: { personal: number; page: number }) => callback(counts);
    ipcRenderer.on('update-tab-badges', handler);
    return () => {
      ipcRenderer.removeListener('update-tab-badges', handler);
    };
  },
  onThemeChanged: (callback: (theme: ThemeDefinition) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, theme: ThemeDefinition) => callback(theme);
    ipcRenderer.on('theme-applied', handler);
    return () => {
      ipcRenderer.removeListener('theme-applied', handler);
    };
  },
  onSettingsChanged: (callback: (settings: AppSettings) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, settings: AppSettings) => callback(settings);
    ipcRenderer.on('settings-changed', handler);
    return () => {
      ipcRenderer.removeListener('settings-changed', handler);
    };
  }
};

contextBridge.exposeInMainWorld('tabbarAPI', tabbarAPI);

declare global {
  interface Window {
    tabbarAPI: TabBarAPI;
  }
}
