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

export interface AppSettings {
  muteNotifications: boolean;
  minimizeToTray: boolean;
  startMinimized: boolean;
  autoLaunch: boolean;
  theme: 'system' | 'light' | 'dark';
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
}

declare global {
  interface Window {
    messengerDesktop?: MessengerDesktopAPI;
  }
}
