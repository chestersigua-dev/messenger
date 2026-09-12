import { contextBridge, ipcRenderer } from 'electron';
import { NotificationPayload, MessengerDesktopAPI } from '../types';

/**
 * Parses unread message count from the document title.
 * Examples: "(3) Messenger", "(12) Messenger", "Messenger"
 */
function parseUnreadCountFromTitle(title: string): number {
  const match = title.match(/^\((\d+)\)/);
  if (match && match[1]) {
    return parseInt(match[1], 10);
  }
  return 0;
}

/**
 * Parses unread badges from Messenger DOM elements as a secondary fallback.
 */
function parseUnreadCountFromDom(): number {
  try {
    // Check elements with aria-label containing unread or badge counts
    const badgeElements = document.querySelectorAll('[aria-label*="unread"], [role="status"]');
    let maxCount = 0;

    badgeElements.forEach((el) => {
      const text = el.textContent?.trim() || '';
      const num = parseInt(text, 10);
      if (!isNaN(num) && num > maxCount) {
        maxCount = num;
      }
    });

    return maxCount;
  } catch {
    return 0;
  }
}

let lastReportedCount = 0;

function checkAndUpdateUnreadCount(): void {
  const titleCount = parseUnreadCountFromTitle(document.title);
  const domCount = parseUnreadCountFromDom();
  const count = Math.max(titleCount, domCount);

  if (count !== lastReportedCount) {
    lastReportedCount = count;
    ipcRenderer.send('set-unread-count', { count });
  }
}

/**
 * Hooks into the HTML5 Notification API to dispatch native Windows desktop notifications.
 */
function hookHtml5Notifications(): void {
  // Notification proxy class
  class CustomNotification extends EventTarget {
    static get permission(): NotificationPermission {
      return 'granted';
    }

    static requestPermission(): Promise<NotificationPermission> {
      return Promise.resolve('granted');
    }

    title: string;
    body: string;
    icon: string;
    tag: string;
    onclick: ((this: Notification, ev: Event) => unknown) | null = null;
    onerror: ((this: Notification, ev: Event) => unknown) | null = null;
    onclose: ((this: Notification, ev: Event) => unknown) | null = null;
    onshow: ((this: Notification, ev: Event) => unknown) | null = null;

    constructor(title: string, options?: NotificationOptions) {
      super();
      this.title = title;
      this.body = options?.body || '';
      this.icon = options?.icon || '';
      this.tag = options?.tag || '';

      const id = Math.random().toString(36).substring(2, 9);

      const payload: NotificationPayload = {
        id,
        title: this.title,
        body: this.body,
        icon: this.icon,
        tag: this.tag,
        data: (options?.data as Record<string, unknown>) || {}
      };

      ipcRenderer.send('show-notification', payload);

      // Listen for click event dispatched from main process
      const removeClickListener = ipcRenderer.on('notification-clicked', (_e, data) => {
        if (data.id === id || !data.id) {
          if (this.onclick) {
            this.onclick.call(this as unknown as Notification, new Event('click'));
          }
          this.dispatchEvent(new Event('click'));
        }
      });

      // Cleanup
      this.addEventListener('close', () => {
        ipcRenderer.removeListener('notification-clicked', removeClickListener as unknown as (...args: unknown[]) => void);
      });
    }

    close(): void {
      this.dispatchEvent(new Event('close'));
    }
  }

  // Override window.Notification
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).Notification = CustomNotification;
}

/**
 * Injects modern Windows desktop styling enhancements (custom scrollbars, seamless integration).
 */
function injectDesktopStyles(): void {
  const styleEl = document.createElement('style');
  styleEl.id = 'messenger-desktop-custom-styles';
  styleEl.textContent = `
    /* Fluent Windows Scrollbars */
    ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }
    ::-webkit-scrollbar-track {
      background: transparent;
    }
    ::-webkit-scrollbar-thumb {
      background: rgba(120, 120, 120, 0.35);
      border-radius: 4px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: rgba(120, 120, 120, 0.6);
    }
    /* Ensure clean selection behavior */
    ::selection {
      background-color: rgba(0, 132, 255, 0.3);
    }
  `;

  if (document.head) {
    document.head.appendChild(styleEl);
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      document.head?.appendChild(styleEl);
    });
  }
}

// Initialize notification hooks
hookHtml5Notifications();

// Observe document title mutations to detect unread count changes
window.addEventListener('DOMContentLoaded', () => {
  injectDesktopStyles();

  const titleEl = document.querySelector('title');
  if (titleEl) {
    const titleObserver = new MutationObserver(() => {
      checkAndUpdateUnreadCount();
    });
    titleObserver.observe(titleEl, { subtree: true, characterData: true, childList: true });
  }

  // Also observe DOM tree periodically and on mutations
  const bodyObserver = new MutationObserver(() => {
    checkAndUpdateUnreadCount();
  });

  if (document.body) {
    bodyObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-label']
    });
  }

  // Initial check
  checkAndUpdateUnreadCount();
});

// Periodic fallback check every 3 seconds
setInterval(checkAndUpdateUnreadCount, 3000);

// Expose sanitized desktop API to the main world via contextBridge
const desktopAPI: MessengerDesktopAPI = {
  sendNotification: (payload: NotificationPayload) => {
    ipcRenderer.send('show-notification', payload);
  },
  updateUnreadCount: (count: number) => {
    ipcRenderer.send('set-unread-count', { count });
  },
  onThemeChanged: (callback: (isDark: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, isDark: boolean) => callback(isDark);
    ipcRenderer.on('theme-changed', handler);
    return () => {
      ipcRenderer.removeListener('theme-changed', handler);
    };
  },
  onNotificationClicked: (callback: (payload: { id?: string; data?: unknown }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { id?: string; data?: unknown }) => callback(payload);
    ipcRenderer.on('notification-clicked', handler);
    return () => {
      ipcRenderer.removeListener('notification-clicked', handler);
    };
  },
  openExternalUrl: (url: string) => {
    ipcRenderer.send('open-external-url', url);
  },
  toggleFullscreen: () => {
    ipcRenderer.send('toggle-fullscreen');
  },
  getPlatform: () => process.platform
};

contextBridge.exposeInMainWorld('messengerDesktop', desktopAPI);
