export interface UnreadCountPayload {
  count: number;
}

export interface NotificationPayload {
  id?: string;
  title: string;
  body: string;
  icon?: string;
  tag?: string;
  data?: {
    threadId?: string;
    url?: string;
    [key: string]: unknown;
  };
}

export interface CallStatePayload {
  status: 'incoming' | 'connected' | 'ended';
  callerName?: string;
  isVideo?: boolean;
}

export type ThemeId =
  | 'dark-midnight'
  | 'dark-oled'
  | 'dark-cyberpunk'
  | 'light-clean'
  | 'light-sepia'
  | 'light-nordic';

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  category: 'dark' | 'light';
  description: string;
  previewColors: {
    bg: string;
    card: string;
    accent: string;
    text: string;
  };
}

export interface AppSettings {
  muteNotifications: boolean;
  minimizeToTray: boolean;
  alwaysOnTop: boolean;
  startMinimized: boolean;
  autoLaunch: boolean;
  theme: ThemeId;
  hardwareAcceleration: boolean;
}

export interface MessengerDesktopAPI {
  sendNotification: (payload: NotificationPayload) => void;
  updateUnreadCount: (count: number) => void;
  onThemeChanged: (callback: (isDark: boolean) => void) => () => void;
  onNotificationClicked: (callback: (payload: { id?: string; data?: unknown }) => void) => () => void;
  openExternalUrl: (url: string) => void;
  toggleFullscreen: () => void;
  getPlatform: () => string;
  getSettings: () => Promise<AppSettings>;
  updateSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>;
  onSettingsChanged: (callback: (settings: AppSettings) => void) => () => void;
  getThemes: () => Promise<ThemeDefinition[]>;
  openPreferences: () => void;
}

declare global {
  interface Window {
    messengerDesktop?: MessengerDesktopAPI;
  }
}

