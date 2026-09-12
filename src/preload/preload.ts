import { contextBridge, ipcRenderer } from 'electron';
import { NotificationPayload, MessengerDesktopAPI, AppSettings, ThemeDefinition } from '../types';

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

      const removeClickListener = ipcRenderer.on('notification-clicked', (_e, data) => {
        if (data.id === id || !data.id) {
          if (this.onclick) {
            this.onclick.call(this as unknown as Notification, new Event('click'));
          }
          this.dispatchEvent(new Event('click'));
        }
      });

      this.addEventListener('close', () => {
        ipcRenderer.removeListener('notification-clicked', removeClickListener as unknown as (...args: unknown[]) => void);
      });
    }

    close(): void {
      this.dispatchEvent(new Event('close'));
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).Notification = CustomNotification;
}

/**
 * Injects desktop styling enhancements.
 */
function injectDesktopStyles(): void {
  const styleEl = document.createElement('style');
  styleEl.id = 'messenger-desktop-custom-styles';
  styleEl.textContent = `
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

/**
 * Preferences & Themes UI Component
 */
let preferencesModalEl: HTMLDivElement | null = null;
let isModalOpen = false;

async function openPreferencesModal(): Promise<void> {
  if (isModalOpen && preferencesModalEl) {
    preferencesModalEl.style.display = 'flex';
    return;
  }

  const [settings, themes] = await Promise.all([
    ipcRenderer.invoke('get-settings') as Promise<AppSettings>,
    ipcRenderer.invoke('get-themes') as Promise<ThemeDefinition[]>
  ]);

  if (!preferencesModalEl) {
    preferencesModalEl = document.createElement('div');
    preferencesModalEl.id = 'messenger-preferences-modal-root';
    document.body.appendChild(preferencesModalEl);
  }

  isModalOpen = true;
  preferencesModalEl.style.display = 'flex';
  renderPreferencesContent(settings, themes);
}

function closePreferencesModal(): void {
  if (preferencesModalEl) {
    preferencesModalEl.style.display = 'none';
  }
  isModalOpen = false;
}

function renderPreferencesContent(settings: AppSettings, themes: ThemeDefinition[]): void {
  if (!preferencesModalEl) return;

  const darkThemes = themes.filter((t) => t.category === 'dark');
  const lightThemes = themes.filter((t) => t.category === 'light');

  preferencesModalEl.innerHTML = `
    <style>
      #messenger-preferences-modal-root {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 999999;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.65);
        backdrop-filter: blur(12px);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        color: #f0f2f5;
        animation: prefFadeIn 0.2s ease-out;
      }

      @keyframes prefFadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      @keyframes prefSlideUp {
        from { transform: translateY(20px) scale(0.97); opacity: 0; }
        to { transform: translateY(0) scale(1); opacity: 1; }
      }

      .pref-card {
        width: 680px;
        max-width: 90vw;
        max-height: 88vh;
        background: #1e1f23;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 16px;
        box-shadow: 0 24px 48px rgba(0, 0, 0, 0.5);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        animation: prefSlideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      }

      .pref-header {
        padding: 20px 24px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: rgba(255, 255, 255, 0.02);
      }

      .pref-title-group h2 {
        margin: 0;
        font-size: 20px;
        font-weight: 600;
        color: #ffffff;
      }

      .pref-title-group p {
        margin: 4px 0 0;
        font-size: 13px;
        color: #949ba4;
      }

      .pref-close-btn {
        background: transparent;
        border: none;
        color: #949ba4;
        font-size: 24px;
        line-height: 1;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 8px;
        transition: all 0.15s ease;
      }

      .pref-close-btn:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #ffffff;
      }

      .pref-body {
        padding: 24px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 24px;
      }

      .pref-section-title {
        font-size: 14px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #0084ff;
        margin-bottom: 12px;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .pref-theme-subheading {
        font-size: 12px;
        font-weight: 500;
        color: #80848e;
        margin: 8px 0 6px;
      }

      .pref-theme-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 12px;
      }

      .theme-item {
        background: #2b2d31;
        border: 2px solid transparent;
        border-radius: 12px;
        padding: 12px;
        cursor: pointer;
        transition: all 0.18s ease;
        display: flex;
        flex-direction: column;
        gap: 8px;
        position: relative;
      }

      .theme-item:hover {
        background: #313338;
        border-color: rgba(255, 255, 255, 0.2);
        transform: translateY(-2px);
      }

      .theme-item.active {
        border-color: #0084ff;
        background: #313338;
        box-shadow: 0 0 16px rgba(0, 132, 255, 0.35);
      }

      .theme-palette-preview {
        height: 24px;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px;
        border-radius: 6px;
        background: rgba(0, 0, 0, 0.2);
      }

      .palette-dot {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        border: 1px solid rgba(255, 255, 255, 0.15);
      }

      .theme-name {
        font-size: 13px;
        font-weight: 600;
        color: #ffffff;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .theme-badge {
        font-size: 10px;
        font-weight: 500;
        padding: 2px 6px;
        border-radius: 4px;
        background: rgba(255, 255, 255, 0.1);
        color: #dbdee1;
      }

      .theme-desc {
        font-size: 11px;
        color: #949ba4;
        line-height: 1.35;
      }

      /* Options / Toggles */
      .pref-option-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 16px;
        background: #2b2d31;
        border-radius: 12px;
        transition: background 0.15s ease;
      }

      .pref-option-row:hover {
        background: #313338;
      }

      .pref-option-info h4 {
        margin: 0;
        font-size: 14px;
        font-weight: 500;
        color: #ffffff;
      }

      .pref-option-info p {
        margin: 3px 0 0;
        font-size: 12px;
        color: #949ba4;
      }

      /* Toggle switch */
      .switch {
        position: relative;
        display: inline-block;
        width: 44px;
        height: 24px;
        flex-shrink: 0;
      }

      .switch input {
        opacity: 0;
        width: 0;
        height: 0;
      }

      .slider {
        position: absolute;
        cursor: pointer;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: #4e5058;
        transition: 0.2s;
        border-radius: 24px;
      }

      .slider:before {
        position: absolute;
        content: "";
        height: 18px;
        width: 18px;
        left: 3px;
        bottom: 3px;
        background-color: white;
        transition: 0.2s;
        border-radius: 50%;
      }

      input:checked + .slider {
        background-color: #0084ff;
      }

      input:checked + .slider:before {
        transform: translateX(20px);
      }

      /* Shortcuts section */
      .pref-shortcuts-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }

      .shortcut-pill {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: rgba(255, 255, 255, 0.04);
        padding: 8px 12px;
        border-radius: 8px;
        font-size: 12px;
      }

      .shortcut-keys {
        font-family: monospace;
        background: rgba(0, 0, 0, 0.35);
        padding: 2px 6px;
        border-radius: 4px;
        color: #0084ff;
        font-size: 11px;
        font-weight: 600;
      }
    </style>

    <div class="pref-card" id="pref-card-container">
      <div class="pref-header">
        <div class="pref-title-group">
          <h2>Preferences & Themes</h2>
          <p>Customize your Messenger appearance and window behavior</p>
        </div>
        <button class="pref-close-btn" id="pref-close-btn" title="Close">&times;</button>
      </div>

      <div class="pref-body">
        <!-- THEMES SECTION -->
        <div>
          <div class="pref-section-title">
            <span>🎨</span>
            <span>Theme Selection (6 Themes)</span>
          </div>

          <div class="pref-theme-subheading">🌙 Dark Themes</div>
          <div class="pref-theme-grid">
            ${darkThemes
              .map(
                (t) => `
              <div class="theme-item ${settings.theme === t.id ? 'active' : ''}" data-theme-id="${t.id}">
                <div class="theme-palette-preview">
                  <div class="palette-dot" style="background: ${t.previewColors.bg};" title="Background"></div>
                  <div class="palette-dot" style="background: ${t.previewColors.card};" title="Card"></div>
                  <div class="palette-dot" style="background: ${t.previewColors.accent};" title="Accent"></div>
                </div>
                <div class="theme-name">
                  <span>${t.name}</span>
                  <span class="theme-badge">Dark</span>
                </div>
                <div class="theme-desc">${t.description}</div>
              </div>
            `
              )
              .join('')}
          </div>

          <div class="pref-theme-subheading" style="margin-top: 14px;">☀️ Light Themes</div>
          <div class="pref-theme-grid">
            ${lightThemes
              .map(
                (t) => `
              <div class="theme-item ${settings.theme === t.id ? 'active' : ''}" data-theme-id="${t.id}">
                <div class="theme-palette-preview">
                  <div class="palette-dot" style="background: ${t.previewColors.bg};" title="Background"></div>
                  <div class="palette-dot" style="background: ${t.previewColors.card};" title="Card"></div>
                  <div class="palette-dot" style="background: ${t.previewColors.accent};" title="Accent"></div>
                </div>
                <div class="theme-name">
                  <span>${t.name}</span>
                  <span class="theme-badge">Light</span>
                </div>
                <div class="theme-desc">${t.description}</div>
              </div>
            `
              )
              .join('')}
          </div>
        </div>

        <!-- WINDOW & BEHAVIOR SECTION -->
        <div>
          <div class="pref-section-title">
            <span>⚙️</span>
            <span>Window & System Behavior</span>
          </div>

          <div style="display: flex; flex-direction: column; gap: 8px;">
            <div class="pref-option-row">
              <div class="pref-option-info">
                <h4>Always on Top</h4>
                <p>Pin the Messenger window above all other open desktop windows</p>
              </div>
              <label class="switch">
                <input type="checkbox" id="pref-toggle-always-on-top" ${settings.alwaysOnTop ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
            </div>

            <div class="pref-option-row">
              <div class="pref-option-info">
                <h4>Minimize to Tray</h4>
                <p>Directly hide Messenger into the Windows system tray when minimized</p>
              </div>
              <label class="switch">
                <input type="checkbox" id="pref-toggle-minimize-tray" ${settings.minimizeToTray ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
            </div>

            <div class="pref-option-row">
              <div class="pref-option-info">
                <h4>Mute Notifications</h4>
                <p>Silence incoming desktop notification popups and sounds</p>
              </div>
              <label class="switch">
                <input type="checkbox" id="pref-toggle-mute" ${settings.muteNotifications ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
            </div>
          </div>
        </div>

        <!-- SHORTCUTS SECTION -->
        <div>
          <div class="pref-section-title">
            <span>⌨️</span>
            <span>Keyboard Shortcuts</span>
          </div>
          <div class="pref-shortcuts-grid">
            <div class="shortcut-pill">
              <span>Always on Top</span>
              <span class="shortcut-keys">Ctrl+Shift+A</span>
            </div>
            <div class="shortcut-pill">
              <span>Cycle Themes</span>
              <span class="shortcut-keys">Ctrl+Shift+T</span>
            </div>
            <div class="shortcut-pill">
              <span>Toggle Messenger Window</span>
              <span class="shortcut-keys">Ctrl+Shift+M</span>
            </div>
            <div class="shortcut-pill">
              <span>Toggle Mute</span>
              <span class="shortcut-keys">Ctrl+Shift+N</span>
            </div>
            <div class="shortcut-pill" style="grid-column: span 2;">
              <span>Preferences & Themes</span>
              <span class="shortcut-keys">Ctrl+~</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Attach event listeners
  const closeBtn = preferencesModalEl.querySelector('#pref-close-btn');
  closeBtn?.addEventListener('click', closePreferencesModal);

  // Click outside to dismiss
  preferencesModalEl.addEventListener('click', (e) => {
    if (e.target === preferencesModalEl) {
      closePreferencesModal();
    }
  });

  // Theme selection click handlers
  const themeItems = preferencesModalEl.querySelectorAll('.theme-item');
  themeItems.forEach((item) => {
    item.addEventListener('click', async () => {
      const themeId = item.getAttribute('data-theme-id');
      if (!themeId) return;

      themeItems.forEach((i) => i.classList.remove('active'));
      item.classList.add('active');

      await ipcRenderer.invoke('update-settings', { theme: themeId });
    });
  });

  // Always on top toggle
  const alwaysOnTopCheckbox = preferencesModalEl.querySelector('#pref-toggle-always-on-top') as HTMLInputElement | null;
  alwaysOnTopCheckbox?.addEventListener('change', async () => {
    await ipcRenderer.invoke('update-settings', { alwaysOnTop: alwaysOnTopCheckbox.checked });
  });

  // Minimize to tray toggle
  const minimizeTrayCheckbox = preferencesModalEl.querySelector('#pref-toggle-minimize-tray') as HTMLInputElement | null;
  minimizeTrayCheckbox?.addEventListener('change', async () => {
    await ipcRenderer.invoke('update-settings', { minimizeToTray: minimizeTrayCheckbox.checked });
  });

  // Mute notifications toggle
  const muteCheckbox = preferencesModalEl.querySelector('#pref-toggle-mute') as HTMLInputElement | null;
  muteCheckbox?.addEventListener('change', async () => {
    await ipcRenderer.invoke('update-settings', { muteNotifications: muteCheckbox.checked });
  });
}

/**
 * Injects a discreet floating quick settings / themes button in the corner of the Messenger web app.
 */
function injectFloatingLauncher(): void {
  const launcher = document.createElement('button');
  launcher.id = 'messenger-desktop-quick-theme-btn';
  launcher.title = 'Themes & Preferences (Ctrl+~)';
  launcher.innerHTML = `🎨`;
  launcher.setAttribute(
    'style',
    `
    position: fixed;
    bottom: 16px;
    right: 16px;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: rgba(30, 31, 35, 0.85);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: #ffffff;
    font-size: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 99999;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    opacity: 0.7;
  `
  );

  launcher.addEventListener('mouseenter', () => {
    launcher.style.transform = 'scale(1.1)';
    launcher.style.opacity = '1';
  });

  launcher.addEventListener('mouseleave', () => {
    launcher.style.transform = 'scale(1)';
    launcher.style.opacity = '0.7';
  });

  launcher.addEventListener('click', () => {
    openPreferencesModal();
  });

  if (document.body) {
    document.body.appendChild(launcher);
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      document.body?.appendChild(launcher);
    });
  }
}

// Global keyboard shortcut listener (Ctrl+~ and Escape)
window.addEventListener('keydown', (event) => {
  if (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    (event.key === '~' || event.key === '`' || event.code === 'Backquote')
  ) {
    event.preventDefault();
    if (isModalOpen) {
      closePreferencesModal();
    } else {
      openPreferencesModal();
    }
  } else if (event.key === 'Escape' && isModalOpen) {
    event.preventDefault();
    closePreferencesModal();
  }
});

// Listen for IPC command to open preferences
ipcRenderer.on('open-preferences', () => {
  openPreferencesModal();
});

// Update modal controls if settings change externally
ipcRenderer.on('settings-changed', (_event, updated: AppSettings) => {
  if (isModalOpen) {
    ipcRenderer.invoke('get-themes').then((themes: ThemeDefinition[]) => {
      renderPreferencesContent(updated, themes);
    });
  }
});

// Initialize notification hooks
hookHtml5Notifications();

// Observe document title mutations to detect unread count changes
window.addEventListener('DOMContentLoaded', () => {
  injectDesktopStyles();
  injectFloatingLauncher();

  const titleEl = document.querySelector('title');
  if (titleEl) {
    const titleObserver = new MutationObserver(() => {
      checkAndUpdateUnreadCount();
    });
    titleObserver.observe(titleEl, { subtree: true, characterData: true, childList: true });
  }

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

  checkAndUpdateUnreadCount();
});

setInterval(checkAndUpdateUnreadCount, 3000);

// Expose desktop API to main world
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
  getPlatform: () => process.platform,
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (settings: Partial<AppSettings>) => ipcRenderer.invoke('update-settings', settings),
  onSettingsChanged: (callback: (settings: AppSettings) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, s: AppSettings) => callback(s);
    ipcRenderer.on('settings-changed', handler);
    return () => {
      ipcRenderer.removeListener('settings-changed', handler);
    };
  },
  getThemes: () => ipcRenderer.invoke('get-themes'),
  openPreferences: () => {
    openPreferencesModal();
  }
};

contextBridge.exposeInMainWorld('messengerDesktop', desktopAPI);
