import { contextBridge, ipcRenderer } from 'electron';
import { NotificationPayload, MessengerDesktopAPI, AppSettings, ThemeDefinition, AccountType } from '../types';

const isPageAccount =
  (typeof process !== 'undefined' && Array.isArray(process.argv) && process.argv.includes('--account-type=page')) ||
  (typeof window !== 'undefined' && window.location && window.location.hostname.includes('business.facebook.com'));

const currentAccount: AccountType = isPageAccount ? 'page' : 'personal';

/**
 * Parses unread message count from the document title.
 * Examples: "(3) Messenger", "(12) Messenger", "(5) Meta Business Suite", "Messenger"
 */
function parseUnreadCountFromTitle(title: string): number {
  const match = title.match(/^\((\d+)\)/);
  if (match && match[1]) {
    return parseInt(match[1], 10);
  }
  return 0;
}

/**
 * Parses unread badges from Messenger or Meta Business Suite DOM elements as a secondary fallback.
 */
function parseUnreadCountFromDom(): number {
  try {
    const badgeElements = document.querySelectorAll(
      '[aria-label*="unread" i], [aria-label*="Unread" i], span[data-badge]'
    );
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
let checkUnreadTimer: ReturnType<typeof setTimeout> | null = null;

function checkAndUpdateUnreadCount(): void {
  const titleCount = parseUnreadCountFromTitle(document.title);
  const domCount = parseUnreadCountFromDom();
  const count = Math.max(titleCount, domCount);

  if (count !== lastReportedCount) {
    lastReportedCount = count;
    ipcRenderer.send('set-unread-count', { count, account: currentAccount });
  }
}

function scheduleUnreadCheck(delayMs = 300): void {
  if (checkUnreadTimer) return;
  checkUnreadTimer = setTimeout(() => {
    checkUnreadTimer = null;
    checkAndUpdateUnreadCount();
  }, delayMs);
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
        account: currentAccount,
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

    /* Native-styled Settings Button below Archive */
    #messenger-desktop-settings-btn {
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      position: relative !important;
      box-sizing: border-box !important;
      cursor: pointer !important;
      border: none !important;
      outline: none !important;
      background-color: transparent !important;
      color: var(--secondary-icon, #a8b3cf) !important;
      border-radius: 8px !important;
      transition: background-color 0.2s ease, color 0.2s ease, transform 0.15s ease !important;
      user-select: none !important;
      -webkit-user-select: none !important;
    }

    #messenger-desktop-settings-btn:hover {
      background-color: var(--hover-overlay, rgba(255, 255, 255, 0.08)) !important;
      color: var(--primary-icon, #0084ff) !important;
    }

    #messenger-desktop-settings-btn:active {
      background-color: rgba(255, 255, 255, 0.15) !important;
      transform: scale(0.96) !important;
    }

    #messenger-desktop-settings-btn svg {
      fill: currentColor !important;
      transition: fill 0.2s ease, transform 0.3s ease !important;
    }

    #messenger-desktop-settings-btn:hover svg {
      transform: rotate(30deg);
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

/**
 * Facebook Page Chooser Modal Component
 */
let pageChooserModalEl: HTMLDivElement | null = null;
let isPageChooserOpen = false;

async function openPageChooserModal(isPostLogin = false): Promise<void> {
  if (isPageChooserOpen && pageChooserModalEl) {
    pageChooserModalEl.style.display = 'flex';
    return;
  }

  const settings = (await ipcRenderer.invoke('get-settings')) as AppSettings;

  if (!pageChooserModalEl) {
    pageChooserModalEl = document.createElement('div');
    pageChooserModalEl.id = 'messenger-page-chooser-modal-root';
    document.body.appendChild(pageChooserModalEl);
  }

  isPageChooserOpen = true;
  pageChooserModalEl.style.display = 'flex';
  renderPageChooserContent(settings, isPostLogin);
}

function closePageChooserModal(): void {
  if (pageChooserModalEl) {
    pageChooserModalEl.style.display = 'none';
  }
  isPageChooserOpen = false;
}

function renderPageChooserContent(settings: AppSettings, isPostLogin: boolean): void {
  if (!pageChooserModalEl) return;

  pageChooserModalEl.innerHTML = `
    <style>
      #messenger-page-chooser-modal-root {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 999999;
        background: rgba(0, 0, 0, 0.75);
        backdrop-filter: blur(8px);
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        animation: pageChooserFadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      }

      @keyframes pageChooserFadeIn {
        from { opacity: 0; transform: scale(0.97); }
        to { opacity: 1; transform: scale(1); }
      }

      .chooser-card {
        background: #242526;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 14px;
        width: 620px;
        max-width: 92vw;
        max-height: 88vh;
        overflow-y: auto;
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
        display: flex;
        flex-direction: column;
        color: #e4e6eb;
      }

      .chooser-header {
        padding: 18px 22px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .chooser-header-info h3 {
        font-size: 17px;
        font-weight: 700;
        color: #fff;
        margin-bottom: 4px;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .chooser-header-info p {
        font-size: 13px;
        color: #a8b3cf;
        line-height: 1.4;
      }

      .chooser-close-btn {
        background: rgba(255, 255, 255, 0.08);
        border: none;
        border-radius: 50%;
        width: 32px;
        height: 32px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #e4e6eb;
        font-size: 18px;
        transition: all 0.15s ease;
      }

      .chooser-close-btn:hover {
        background: rgba(255, 255, 255, 0.15);
        color: #fff;
      }

      .chooser-body {
        padding: 20px 22px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      .chooser-option-card {
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 10px;
        padding: 14px 16px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        transition: all 0.18s ease;
      }

      .chooser-option-card:hover {
        background: rgba(255, 255, 255, 0.07);
        border-color: rgba(0, 132, 255, 0.4);
        transform: translateY(-1px);
      }

      .chooser-option-left {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        flex: 1;
      }

      .chooser-option-icon {
        width: 36px;
        height: 36px;
        border-radius: 8px;
        background: rgba(0, 132, 255, 0.15);
        color: #0084ff;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        flex-shrink: 0;
      }

      .chooser-option-text h4 {
        font-size: 14px;
        font-weight: 600;
        color: #fff;
        margin-bottom: 3px;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .chooser-badge {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        background: rgba(0, 132, 255, 0.25);
        color: #60a5fa;
        padding: 2px 6px;
        border-radius: 4px;
      }

      .chooser-option-text p {
        font-size: 12px;
        color: #a8b3cf;
        line-height: 1.35;
      }

      .chooser-btn {
        background: #0084ff;
        color: #ffffff;
        border: none;
        border-radius: 8px;
        padding: 8px 14px;
        font-size: 12.5px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s ease;
        white-space: nowrap;
        flex-shrink: 0;
      }

      .chooser-btn:hover {
        background: #0073e6;
        box-shadow: 0 2px 8px rgba(0, 132, 255, 0.4);
      }

      .chooser-btn-secondary {
        background: rgba(255, 255, 255, 0.1);
        color: #e4e6eb;
      }

      .chooser-btn-secondary:hover {
        background: rgba(255, 255, 255, 0.16);
        color: #fff;
        box-shadow: none;
      }

      .chooser-custom-box {
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 10px;
        padding: 14px 16px;
      }

      .chooser-custom-box h4 {
        font-size: 13.5px;
        font-weight: 600;
        color: #fff;
        margin-bottom: 4px;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .chooser-custom-box p {
        font-size: 12px;
        color: #a8b3cf;
        margin-bottom: 12px;
      }

      .chooser-custom-inputs {
        display: flex;
        gap: 8px;
        align-items: center;
      }

      .chooser-input {
        background: rgba(0, 0, 0, 0.25);
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 7px;
        padding: 7px 11px;
        color: #fff;
        font-size: 12.5px;
        outline: none;
        transition: border-color 0.15s ease;
      }

      .chooser-input:focus {
        border-color: #0084ff;
      }

      .chooser-footer {
        padding: 14px 22px;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 12px;
        color: #8a8d91;
      }

      .chooser-footer-tip {
        display: flex;
        align-items: center;
        gap: 6px;
      }
    </style>

    <div class="chooser-card">
      <div class="chooser-header">
        <div class="chooser-header-info">
          <h3>
            <span>🏢</span>
            <span>${isPostLogin ? 'Logged In! Select Page to Manage' : 'Select Facebook Page to Manage'}</span>
          </h3>
          <p>${isPostLogin ? 'Choose which Facebook Page messages you want to open in this tab.' : 'Select how you want to access and chat as your Facebook Page.'}</p>
        </div>
        <button class="chooser-close-btn" id="chooser-close" title="Close (Escape)">✕</button>
      </div>

      <div class="chooser-body">
        <!-- Option 1: Meta Business Suite Account Switcher -->
        <div class="chooser-option-card">
          <div class="chooser-option-left">
            <div class="chooser-option-icon">🌐</div>
            <div class="chooser-option-text">
              <h4>
                <span>Meta Business Suite (All Pages)</span>
                <span class="chooser-badge">Recommended</span>
              </h4>
              <p>View all your Business Portfolios and Pages on Meta to pick your Page with one click.</p>
            </div>
          </div>
          <button class="chooser-btn" id="chooser-btn-select-biz">
            Browse All Pages →
          </button>
        </div>

        <!-- Option 2: Facebook Page Identity -->
        <div class="chooser-option-card">
          <div class="chooser-option-left">
            <div class="chooser-option-icon">👥</div>
            <div class="chooser-option-text">
              <h4>Switch Profile on Facebook</h4>
              <p>Opens your Facebook Pages list to switch into your Page profile for direct messaging.</p>
            </div>
          </div>
          <button class="chooser-btn chooser-btn-secondary" id="chooser-btn-fb-pages">
            Switch on Facebook →
          </button>
        </div>

        <!-- Option 3: Universal Inbox -->
        <div class="chooser-option-card">
          <div class="chooser-option-left">
            <div class="chooser-option-icon">📥</div>
            <div class="chooser-option-text">
              <h4>Universal Business Inbox</h4>
              <p>Open the default unified Messenger & Instagram inbox for your primary page.</p>
            </div>
          </div>
          <button class="chooser-btn chooser-btn-secondary" id="chooser-btn-universal">
            Open Default Inbox →
          </button>
        </div>

        <!-- Option 4: Direct Page ID / URL -->
        <div class="chooser-custom-box">
          <h4>
            <span>🎯</span>
            <span>Target Specific Page ID or Custom URL</span>
          </h4>
          <p>Directly load a specific Page using its numeric ID, page username, or custom URL.</p>
          <div class="chooser-custom-inputs">
            <input type="text" id="chooser-input-id" class="chooser-input" style="flex: 1.5;" placeholder="Page ID or Username (e.g. 100084729182371)" value="${settings.pageInboxUrl?.includes('asset_id=') ? settings.pageInboxUrl.split('asset_id=')[1] : ''}">
            <input type="text" id="chooser-input-label" class="chooser-input" style="flex: 1;" placeholder="Tab Label (e.g. Support)" value="${settings.pageInboxName || 'Page Inbox'}">
            <button class="chooser-btn" id="chooser-btn-save-custom">Open Page</button>
          </div>
        </div>
      </div>

      <div class="chooser-footer">
        <div class="chooser-footer-tip">
          <span>💡</span>
          <span>You can also switch pages anytime inside Meta Business Suite's top-left sidebar.</span>
        </div>
        ${isPostLogin ? `
          <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none;">
            <input type="checkbox" id="chooser-chk-dont-ask" ${settings.askPageOnLogin === false ? 'checked' : ''}>
            <span>Don't ask automatically</span>
          </label>
        ` : ''}
      </div>
    </div>
  `;

  // Event handlers
  const closeBtn = pageChooserModalEl.querySelector('#chooser-close');
  closeBtn?.addEventListener('click', closePageChooserModal);

  pageChooserModalEl.addEventListener('click', (e) => {
    if (e.target === pageChooserModalEl) {
      closePageChooserModal();
    }
  });

  // Action 1: Meta Business Suite Pages
  const selectBizBtn = pageChooserModalEl.querySelector('#chooser-btn-select-biz');
  selectBizBtn?.addEventListener('click', async () => {
    closePageChooserModal();
    window.location.href = 'https://business.facebook.com/select_business/';
  });

  // Action 2: Facebook Pages Profile Switch
  const fbPagesBtn = pageChooserModalEl.querySelector('#chooser-btn-fb-pages');
  fbPagesBtn?.addEventListener('click', async () => {
    closePageChooserModal();
    window.location.href = 'https://www.facebook.com/pages/?category=your_pages';
  });

  // Action 3: Universal Inbox
  const universalBtn = pageChooserModalEl.querySelector('#chooser-btn-universal');
  universalBtn?.addEventListener('click', async () => {
    closePageChooserModal();
    window.location.href = 'https://business.facebook.com/latest/inbox';
  });

  // Action 4: Custom Page ID / Name
  const saveCustomBtn = pageChooserModalEl.querySelector('#chooser-btn-save-custom');
  const inputId = pageChooserModalEl.querySelector('#chooser-input-id') as HTMLInputElement | null;
  const inputLabel = pageChooserModalEl.querySelector('#chooser-input-label') as HTMLInputElement | null;

  saveCustomBtn?.addEventListener('click', async () => {
    const rawVal = inputId?.value.trim() || '';
    const label = inputLabel?.value.trim() || 'Page Inbox';

    if (!rawVal) {
      alert('Please enter a Page ID, username, or URL.');
      return;
    }

    let targetUrl = rawVal;
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = `https://business.facebook.com/latest/inbox?asset_id=${encodeURIComponent(rawVal)}`;
    }

    await ipcRenderer.invoke('update-settings', {
      pageInboxUrl: targetUrl,
      pageInboxName: label
    });

    closePageChooserModal();
    window.location.href = targetUrl;
  });

  // Don't ask toggle
  const dontAskChk = pageChooserModalEl.querySelector('#chooser-chk-dont-ask') as HTMLInputElement | null;
  dontAskChk?.addEventListener('change', async () => {
    await ipcRenderer.invoke('update-settings', {
      askPageOnLogin: !dontAskChk.checked
    });
  });
}

function renderPreferencesContent(settings: AppSettings, themes: ThemeDefinition[]): void {
  if (!preferencesModalEl) return;

  const darkThemes = themes.filter((t) => t.category === 'dark');
  const lightThemes = themes.filter((t) => t.category === 'light');
  const currentFontSize = settings.fontSize || 100;

  preferencesModalEl.innerHTML = `
    <style>
      #messenger-preferences-modal-root {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 999999;
        background: rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(6px);
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        animation: prefFadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      }

      @keyframes prefFadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      @keyframes prefScaleIn {
        from { transform: scale(0.95); opacity: 0; }
        to { transform: scale(1); opacity: 1; }
      }

      .pref-card {
        background: #1e1f23;
        color: #ffffff;
        width: 90%;
        max-width: 680px;
        max-height: 85vh;
        border-radius: 16px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        animation: prefScaleIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      }

      .pref-header {
        padding: 20px 24px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .pref-title-group h2 {
        margin: 0;
        font-size: 20px;
        font-weight: 700;
        letter-spacing: -0.3px;
      }

      .pref-title-group p {
        margin: 4px 0 0 0;
        font-size: 13px;
        color: #a8b3cf;
      }

      .pref-close-btn {
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: #ffffff;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        font-size: 18px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s ease;
      }

      .pref-close-btn:hover {
        background: rgba(255, 255, 255, 0.15);
        transform: scale(1.08);
      }

      .pref-body {
        padding: 20px 24px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 24px;
      }

      .pref-section-title {
        font-size: 14px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.8px;
        color: #0084ff;
        margin-bottom: 12px;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .pref-theme-subheading {
        font-size: 12px;
        font-weight: 600;
        color: #a8b3cf;
        margin: 8px 0;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .pref-theme-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 12px;
      }

      .theme-item {
        background: rgba(255, 255, 255, 0.04);
        border: 2px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        padding: 12px;
        cursor: pointer;
        transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .theme-item:hover {
        background: rgba(255, 255, 255, 0.08);
        border-color: rgba(0, 132, 255, 0.5);
        transform: translateY(-2px);
      }

      .theme-item.active {
        background: rgba(0, 132, 255, 0.12);
        border-color: #0084ff;
        box-shadow: 0 0 16px rgba(0, 132, 255, 0.3);
      }

      .theme-palette-preview {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .palette-dot {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        border: 1px solid rgba(255, 255, 255, 0.2);
      }

      .theme-name {
        font-size: 13px;
        font-weight: 600;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .theme-badge {
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 4px;
        background: rgba(255, 255, 255, 0.1);
        color: #a8b3cf;
      }

      .theme-desc {
        font-size: 11px;
        color: #8a8d91;
        line-height: 1.35;
      }

      .pref-option-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 10px;
        transition: background 0.15s ease;
      }

      .pref-option-row:hover {
        background: rgba(255, 255, 255, 0.05);
      }

      .pref-option-info h4 {
        margin: 0;
        font-size: 14px;
        font-weight: 600;
      }

      .pref-option-info p {
        margin: 3px 0 0 0;
        font-size: 12px;
        color: #8a8d91;
      }

      /* Font Size controls */
      .pref-font-controls {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .pref-font-btn {
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.16);
        color: #ffffff;
        padding: 6px 14px;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .pref-font-btn:hover:not(:disabled) {
        background: #0084ff;
        border-color: #0084ff;
        transform: scale(1.05);
      }

      .pref-font-btn:disabled {
        opacity: 0.35;
        cursor: not-allowed;
      }

      .pref-font-indicator {
        min-width: 48px;
        text-align: center;
        font-size: 13px;
        font-weight: 700;
        color: #0084ff;
        font-family: monospace;
      }

      .pref-font-reset-btn {
        background: transparent;
        border: 1px solid rgba(255, 255, 255, 0.15);
        color: #a8b3cf;
        padding: 6px 10px;
        border-radius: 6px;
        font-size: 11px;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .pref-font-reset-btn:hover {
        background: rgba(255, 255, 255, 0.08);
        color: #ffffff;
      }

      /* About section */
      .pref-about-card {
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-left: 3px solid #0084ff;
        border-radius: 8px;
        padding: 14px 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .pref-about-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .pref-about-app-name {
        font-size: 14px;
        font-weight: 700;
        color: #ffffff;
      }

      .pref-about-badge {
        background: rgba(0, 132, 255, 0.18);
        border: 1px solid rgba(0, 132, 255, 0.35);
        color: #0084ff;
        padding: 2px 7px;
        border-radius: 12px;
        font-size: 11px;
        font-weight: 600;
      }

      .pref-about-quote {
        font-size: 13px;
        font-style: italic;
        color: #e4e6eb;
        line-height: 1.45;
        padding: 4px 0;
      }

      .pref-about-footer {
        font-size: 11px;
        color: #8a8d91;
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

        <!-- FACEBOOK PAGE & BUSINESS SUITE SECTION -->
        <div>
          <div class="pref-section-title">
            <span>🏢</span>
            <span>Facebook Page Management & Inbox</span>
          </div>

          <div style="display: flex; flex-direction: column; gap: 10px;">
            <div class="pref-option-row">
              <div class="pref-option-info">
                <h4>Enable Page Chat Tab</h4>
                <p>Show a dedicated tab to chat as a Facebook Page you manage</p>
              </div>
              <label class="switch">
                <input type="checkbox" id="pref-toggle-enable-page" ${settings.enablePageInbox ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
            </div>

            <div class="pref-option-row" style="flex-direction: column; align-items: stretch; gap: 8px;">
              <div class="pref-option-info">
                <h4>Page Service / Platform</h4>
                <p>Choose which platform to use for managing your Page conversations</p>
              </div>
              <select id="pref-select-page-url" style="background: rgba(255, 255, 255, 0.08); color: #fff; border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 8px; padding: 8px 12px; font-size: 13px; outline: none; cursor: pointer;">
                <option value="https://business.facebook.com/latest/inbox" ${!settings.pageInboxUrl || settings.pageInboxUrl === 'https://business.facebook.com/latest/inbox' ? 'selected' : ''}>Meta Business Suite Inbox (Universal) - Recommended</option>
                <option value="https://business.facebook.com/latest/inbox/messenger" ${settings.pageInboxUrl === 'https://business.facebook.com/latest/inbox/messenger' ? 'selected' : ''}>Meta Business Suite (Messenger Only)</option>
                <option value="https://business.facebook.com/latest/inbox/all" ${settings.pageInboxUrl === 'https://business.facebook.com/latest/inbox/all' ? 'selected' : ''}>Meta Business Suite (Unified: All Messages)</option>
                <option value="https://www.facebook.com/messages" ${settings.pageInboxUrl === 'https://www.facebook.com/messages' ? 'selected' : ''}>Facebook Page Messages (Direct)</option>
              </select>
            </div>

            <div class="pref-option-row">
              <div class="pref-option-info">
                <h4>Custom Tab Label</h4>
                <p>Display name for the Page tab (e.g. your Page or Brand name)</p>
              </div>
              <input type="text" id="pref-input-page-name" value="${settings.pageInboxName || 'Page Inbox'}" placeholder="e.g. Support or Brand" style="background: rgba(255, 255, 255, 0.08); color: #fff; border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 8px; padding: 6px 10px; font-size: 13px; width: 140px; text-align: right; outline: none;">
            </div>

            <div class="pref-option-row">
              <div class="pref-option-info">
                <h4>Mute Page Notifications</h4>
                <p>Silence notifications specifically from the Page while keeping Personal unmuted</p>
              </div>
              <label class="switch">
                <input type="checkbox" id="pref-toggle-mute-page" ${settings.mutePageNotifications ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
            </div>

            <div class="pref-option-row">
              <div class="pref-option-info">
                <h4>Include in Taskbar Badge</h4>
                <p>Combine Page unread count into the Windows taskbar and system tray badge</p>
              </div>
              <label class="switch">
                <input type="checkbox" id="pref-toggle-page-badge" ${settings.includePageInTaskbarBadge ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
            </div>

            <div class="pref-option-row" style="padding-top: 6px;">
              <div class="pref-option-info">
                <h4>Switch / Choose Managed Page</h4>
                <p>Select which Facebook Page inbox you want to manage or browse all pages</p>
              </div>
              <button type="button" id="pref-btn-select-page" style="background: rgba(0, 132, 255, 0.15); color: #0084ff; border: 1px solid rgba(0, 132, 255, 0.3); border-radius: 8px; padding: 7px 14px; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.15s ease;">
                Switch Page...
              </button>
            </div>

            <div class="pref-option-row" style="padding-top: 6px;">
              <div class="pref-option-info">
                <h4>Reset Page Login Session</h4>
                <p>Clear stored cookies and log out of the Page tab to switch accounts</p>
              </div>
              <button type="button" id="pref-btn-reset-page" style="background: rgba(250, 62, 62, 0.15); color: #ff6b6b; border: 1px solid rgba(250, 62, 62, 0.3); border-radius: 8px; padding: 7px 14px; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.15s ease;">
                Log Out of Page
              </button>
            </div>
          </div>
        </div>

        <!-- TEXT & FONT SIZE SECTION -->
        <div>
          <div class="pref-section-title">
            <span>🔍</span>
            <span>Text & Font Size</span>
          </div>
          <div class="pref-option-row">
            <div class="pref-option-info">
              <h4>Font & Display Scaling</h4>
              <p>Scale message text and application interface for enhanced readability</p>
            </div>
            <div class="pref-font-controls">
              <button type="button" class="pref-font-btn" id="pref-font-decrease" title="Decrease font size (Ctrl+-)" ${currentFontSize <= 70 ? 'disabled' : ''}>
                A−
              </button>
              <span class="pref-font-indicator" id="pref-font-indicator">${currentFontSize}%</span>
              <button type="button" class="pref-font-btn" id="pref-font-increase" title="Increase font size (Ctrl++)" ${currentFontSize >= 160 ? 'disabled' : ''}>
                A+
              </button>
              <button type="button" class="pref-font-reset-btn" id="pref-font-reset" title="Reset font size to 100% (Ctrl+0)">
                Reset
              </button>
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
              <span>Personal Tab</span>
              <span class="shortcut-keys">Ctrl+1</span>
            </div>
            <div class="shortcut-pill">
              <span>Page Inbox Tab</span>
              <span class="shortcut-keys">Ctrl+2</span>
            </div>
            <div class="shortcut-pill">
              <span>Toggle Tabs</span>
              <span class="shortcut-keys">Ctrl+Tab</span>
            </div>
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
            <div class="shortcut-pill">
              <span>Zoom In</span>
              <span class="shortcut-keys">Ctrl++</span>
            </div>
            <div class="shortcut-pill">
              <span>Zoom Out</span>
              <span class="shortcut-keys">Ctrl+-</span>
            </div>
          </div>
        </div>

        <!-- ABOUT SECTION -->
        <div>
          <div class="pref-section-title">
            <span>ℹ️</span>
            <span>About</span>
          </div>
          <div class="pref-about-card">
            <div class="pref-about-header">
              <span class="pref-about-app-name">Messenger Desktop</span>
              <span class="pref-about-badge">v1.1.1</span>
            </div>
            <div class="pref-about-quote">
              &ldquo;Developed with rage because Meta is BS by Chester Sigua.&rdquo;
            </div>
            <div class="pref-about-footer">
              Open-source Windows desktop client for Messenger
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

  // Font size handlers
  let activeFontSize = currentFontSize;
  const decBtn = preferencesModalEl.querySelector('#pref-font-decrease') as HTMLButtonElement | null;
  const incBtn = preferencesModalEl.querySelector('#pref-font-increase') as HTMLButtonElement | null;
  const resetBtn = preferencesModalEl.querySelector('#pref-font-reset') as HTMLButtonElement | null;
  const indicator = preferencesModalEl.querySelector('#pref-font-indicator');

  const updateFontUI = async (newSize: number) => {
    activeFontSize = Math.min(160, Math.max(70, newSize));
    if (indicator) indicator.textContent = `${activeFontSize}%`;
    if (decBtn) decBtn.disabled = activeFontSize <= 70;
    if (incBtn) incBtn.disabled = activeFontSize >= 160;
    await ipcRenderer.invoke('update-settings', { fontSize: activeFontSize });
  };

  decBtn?.addEventListener('click', () => updateFontUI(activeFontSize - 10));
  incBtn?.addEventListener('click', () => updateFontUI(activeFontSize + 10));
  resetBtn?.addEventListener('click', () => updateFontUI(100));

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

  // Enable Page Inbox toggle
  const enablePageCheckbox = preferencesModalEl.querySelector('#pref-toggle-enable-page') as HTMLInputElement | null;
  enablePageCheckbox?.addEventListener('change', async () => {
    await ipcRenderer.invoke('update-settings', { enablePageInbox: enablePageCheckbox.checked });
  });

  // Page URL select
  const pageUrlSelect = preferencesModalEl.querySelector('#pref-select-page-url') as HTMLSelectElement | null;
  pageUrlSelect?.addEventListener('change', async () => {
    await ipcRenderer.invoke('update-settings', { pageInboxUrl: pageUrlSelect.value });
  });

  // Page Name input
  const pageNameInput = preferencesModalEl.querySelector('#pref-input-page-name') as HTMLInputElement | null;
  pageNameInput?.addEventListener('blur', async () => {
    const val = pageNameInput.value.trim() || 'Page Inbox';
    await ipcRenderer.invoke('update-settings', { pageInboxName: val });
  });

  // Mute Page notifications toggle
  const mutePageCheckbox = preferencesModalEl.querySelector('#pref-toggle-mute-page') as HTMLInputElement | null;
  mutePageCheckbox?.addEventListener('change', async () => {
    await ipcRenderer.invoke('update-settings', { mutePageNotifications: mutePageCheckbox.checked });
  });

  // Include Page in Taskbar badge toggle
  const pageBadgeCheckbox = preferencesModalEl.querySelector('#pref-toggle-page-badge') as HTMLInputElement | null;
  pageBadgeCheckbox?.addEventListener('change', async () => {
    await ipcRenderer.invoke('update-settings', { includePageInTaskbarBadge: pageBadgeCheckbox.checked });
  });

  // Select Page button in Preferences
  const selectPageBtn = preferencesModalEl.querySelector('#pref-btn-select-page') as HTMLButtonElement | null;
  selectPageBtn?.addEventListener('click', () => {
    closePreferencesModal();
    openPageChooserModal(false);
  });

  // Reset Page session button
  const resetPageBtn = preferencesModalEl.querySelector('#pref-btn-reset-page') as HTMLButtonElement | null;
  resetPageBtn?.addEventListener('click', async () => {
    if (confirm('Are you sure you want to log out of the Page tab? This will clear its login cookies.')) {
      resetPageBtn.textContent = 'Logging out...';
      resetPageBtn.disabled = true;
      await ipcRenderer.invoke('reset-page-session');
      resetPageBtn.textContent = 'Logged Out';
      setTimeout(() => {
        if (resetPageBtn) {
          resetPageBtn.textContent = 'Log Out of Page';
          resetPageBtn.disabled = false;
        }
      }, 2000);
    }
  });
}

/**
 * Settings button below the Archive button in Messenger's navigation rail.
 */
let settingsButtonEl: HTMLElement | null = null;
let settingsItemWrapperEl: HTMLElement | null = null;

function findArchiveElement(): HTMLElement | null {
  if (currentAccount !== 'personal') return null;
  // Strategy 1: Find by aria-label (case-insensitive)
  const ariaSelectors = [
    'a[aria-label*="Archived chats" i]',
    'a[aria-label*="Archived Chats" i]',
    'a[aria-label*="Archive" i]',
    'a[aria-label*="Archived" i]',
    '[role="tab"][aria-label*="Archive" i]',
    '[role="button"][aria-label*="Archive" i]',
    '[role="link"][aria-label*="Archive" i]',
    '[aria-label*="Archived chats" i]',
    '[aria-label*="Archived Chats" i]',
    '[aria-label*="Archived" i]',
    '[aria-label*="Archive" i]',
    '[aria-label*="Naka-archive" i]',
    '[aria-label*="Archiv" i]'
  ];

  for (const sel of ariaSelectors) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el && el.id !== 'messenger-desktop-settings-btn' && !el.closest('#messenger-desktop-settings-btn-wrapper')) {
      return el;
    }
  }

  // Strategy 2: Find by href
  const hrefSelectors = [
    'a[href*="/archive/"]',
    'a[href$="/archive"]',
    'a[href*="/archived"]'
  ];

  for (const sel of hrefSelectors) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el && el.id !== 'messenger-desktop-settings-btn' && !el.closest('#messenger-desktop-settings-btn-wrapper')) {
      return el;
    }
  }

  // Strategy 3: Check interactive elements containing "archive"
  const allInteractive = document.querySelectorAll<HTMLElement>('a, [role="tab"], [role="link"], [role="button"]');
  for (const el of Array.from(allInteractive)) {
    if (el.id === 'messenger-desktop-settings-btn' || el.closest('#messenger-desktop-settings-btn-wrapper')) continue;
    const label = (el.getAttribute('aria-label') || el.getAttribute('title') || '').toLowerCase();
    if (label.includes('archiv')) {
      return el;
    }
  }

  // Strategy 4: Fallback to the navigation rail group
  const navContainer = document.querySelector<HTMLElement>('nav, [role="navigation"], [role="tablist"]');
  if (navContainer) {
    const navItems = Array.from(
      navContainer.querySelectorAll<HTMLElement>('a[role="link"], a, [role="tab"], [role="button"]')
    ).filter(
      (item) => item.id !== 'messenger-desktop-settings-btn' && !item.closest('#messenger-desktop-settings-btn-wrapper')
    );

    if (navItems.length >= 3) {
      return navItems[navItems.length - 1];
    }
  }

  return null;
}

function getArchiveContainer(archiveEl: HTMLElement): HTMLElement {
  const parent = archiveEl.parentElement;
  if (
    parent &&
    parent.children.length === 1 &&
    parent.parentElement &&
    parent.parentElement.children.length > 1
  ) {
    return parent;
  }
  return archiveEl;
}

function ensureSettingsButtonAttached(): void {
  const archiveEl = findArchiveElement();
  if (!archiveEl) return;

  const targetContainer = getArchiveContainer(archiveEl);

  // If already properly placed right after the archive item, do nothing
  if (
    settingsItemWrapperEl &&
    settingsItemWrapperEl.isConnected &&
    targetContainer.nextElementSibling === settingsItemWrapperEl
  ) {
    return;
  }
  if (
    settingsButtonEl &&
    settingsButtonEl.isConnected &&
    targetContainer.nextElementSibling === settingsButtonEl
  ) {
    return;
  }

  // Create or reuse settings button
  if (!settingsButtonEl) {
    settingsButtonEl = document.createElement('div');
    settingsButtonEl.id = 'messenger-desktop-settings-btn';
    settingsButtonEl.setAttribute('role', 'button');
    settingsButtonEl.setAttribute('tabindex', '0');
    settingsButtonEl.setAttribute('aria-label', 'Preferences & Themes');
    settingsButtonEl.setAttribute('title', 'Preferences & Themes');

    settingsButtonEl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPreferencesModal();
    });

    settingsButtonEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        openPreferencesModal();
      }
    });
  }

  // Copy class name from archive button for layout and sizing
  settingsButtonEl.className = archiveEl.className || '';
  settingsButtonEl.classList.remove('selected', 'active');

  // Detect icon dimensions from archive SVG
  const archiveSvg = archiveEl.querySelector('svg');
  let svgDim = '20';
  if (archiveSvg) {
    const w = archiveSvg.getAttribute('width');
    if (w && !isNaN(parseInt(w, 10))) {
      svgDim = w;
    } else {
      const rect = archiveSvg.getBoundingClientRect();
      if (rect.width > 0) {
        svgDim = String(Math.round(rect.width));
      }
    }
  }

  // Gear SVG matching Messenger's navigation icon aesthetic
  const gearSvg = `
    <svg width="${svgDim}" height="${svgDim}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
    </svg>
  `;

  // Retain inner wrapper structure if archive button uses one
  const innerChild = archiveEl.firstElementChild;
  if (innerChild && innerChild.tagName.toLowerCase() === 'div') {
    settingsButtonEl.innerHTML = `<div class="${innerChild.className}">${gearSvg}</div>`;
  } else {
    settingsButtonEl.innerHTML = gearSvg;
  }

  // If archive button has visible text (expanded navigation view), append matching text label
  const archiveText = archiveEl.innerText?.trim();
  if (archiveText) {
    const textSpan = document.createElement('span');
    textSpan.className = 'messenger-desktop-settings-text-label';
    textSpan.textContent = 'Settings';
    textSpan.setAttribute('style', 'margin-left: 12px; font-weight: 500; font-size: 15px;');
    settingsButtonEl.appendChild(textSpan);
  }

  // Insert below target container
  if (targetContainer !== archiveEl) {
    if (!settingsItemWrapperEl) {
      settingsItemWrapperEl = document.createElement('div');
      settingsItemWrapperEl.id = 'messenger-desktop-settings-btn-wrapper';
    }
    settingsItemWrapperEl.className = targetContainer.className || '';
    settingsItemWrapperEl.innerHTML = '';
    settingsItemWrapperEl.appendChild(settingsButtonEl);
    targetContainer.insertAdjacentElement('afterend', settingsItemWrapperEl);
  } else {
    targetContainer.insertAdjacentElement('afterend', settingsButtonEl);
  }
}

// Global keyboard shortcut listener (Escape to close modals)
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (isPageChooserOpen) {
      event.preventDefault();
      closePageChooserModal();
    } else if (isModalOpen) {
      event.preventDefault();
      closePreferencesModal();
    }
  }
});

// Listen for IPC command to open preferences
ipcRenderer.on('open-preferences', () => {
  openPreferencesModal();
});

// Listen for IPC command to open page chooser
ipcRenderer.on('open-page-chooser', (_event, data?: { isPostLogin?: boolean }) => {
  openPageChooserModal(data?.isPostLogin || false);
});

function applyDomThemeClasses(isDark: boolean): void {
  try {
    document.documentElement.style.setProperty('color-scheme', isDark ? 'dark' : 'light', 'important');
    // Strictly ONLY manipulate Messenger-specific theme classes on personal Messenger
    if (currentAccount === 'personal') {
      if (isDark) {
        document.documentElement.classList.remove('__fb-light-mode');
        document.documentElement.classList.add('__fb-dark-mode');
        if (document.body) {
          document.body.classList.remove('__fb-light-mode');
          document.body.classList.add('__fb-dark-mode');
        }
      } else {
        document.documentElement.classList.remove('__fb-dark-mode');
        document.documentElement.classList.add('__fb-light-mode');
        if (document.body) {
          document.body.classList.remove('__fb-dark-mode');
          document.body.classList.add('__fb-light-mode');
        }
      }
    }
  } catch {}
}

ipcRenderer.on('theme-changed', (_event, isDark: boolean) => {
  applyDomThemeClasses(isDark);
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
  if (currentAccount === 'personal') {
    ensureSettingsButtonAttached();
  }

  ipcRenderer.invoke('get-settings').then((settings: AppSettings) => {
    ipcRenderer.invoke('get-themes').then((themes: ThemeDefinition[]) => {
      const current = themes.find((t) => t.id === settings.theme);
      if (current) {
        applyDomThemeClasses(current.category === 'dark');
      }
    });
  });

  const titleEl = document.querySelector('title');
  if (titleEl) {
    const titleObserver = new MutationObserver(() => {
      scheduleUnreadCheck(150);
    });
    titleObserver.observe(titleEl, { subtree: true, characterData: true, childList: true });
  }

  // Strictly ONLY observe body mutations on personal Messenger view.
  // Meta Business Suite runs heavy React hydration; observing its body subtree freezes the renderer thread!
  if (currentAccount === 'personal' && document.body) {
    const bodyObserver = new MutationObserver(() => {
      scheduleUnreadCheck(600);
      ensureSettingsButtonAttached();
    });

    bodyObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-label']
    });
  }

  checkAndUpdateUnreadCount();
});

setInterval(() => {
  checkAndUpdateUnreadCount();
  if (currentAccount === 'personal') {
    ensureSettingsButtonAttached();
  }
}, 3000);

// Expose desktop API to main world
const desktopAPI: MessengerDesktopAPI = {
  sendNotification: (payload: NotificationPayload) => {
    ipcRenderer.send('show-notification', payload);
  },
  updateUnreadCount: (count: number, account?: AccountType) => {
    ipcRenderer.send('set-unread-count', { count, account: account || currentAccount });
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
  },
  openPageChooser: () => {
    openPageChooserModal();
  },
  switchTab: (tab: AccountType) => {
    ipcRenderer.send('switch-tab', tab);
  },
  resetPageSession: () => ipcRenderer.invoke('reset-page-session')
};

contextBridge.exposeInMainWorld('messengerDesktop', desktopAPI);
