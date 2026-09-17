import { BrowserWindow, shell, HandlerDetails, WindowOpenHandlerResponse } from 'electron';

// List of allowed domains that should remain inside the Electron app
const ALLOWED_DOMAINS = [
  'messenger.com',
  'www.messenger.com',
  'facebook.com',
  'www.facebook.com',
  'm.facebook.com',
  'web.facebook.com',
  'login.facebook.com',
  'auth.facebook.com',
  'business.facebook.com',
  'business.meta.com',
  'instagram.com',
  'www.instagram.com',
  'cdninstagram.com',
  'fb.com',
  'fbcdn.net',
  'fbsbx.com',
  'meta.com',
  'accountkit.com'
];

/**
 * Checks if a given URL belongs to the internal Facebook/Messenger ecosystem.
 */
export function isAllowedInternalUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const hostname = parsed.hostname.toLowerCase();

    // Check exact match or subdomains
    return ALLOWED_DOMAINS.some((domain) => {
      return hostname === domain || hostname.endsWith(`.${domain}`);
    });
  } catch {
    return false;
  }
}

/**
 * Checks if a URL is an OAuth or Authentication endpoint
 */
export function isAuthUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const pathname = parsed.pathname.toLowerCase();
    const hostname = parsed.hostname.toLowerCase();

    if (!isAllowedInternalUrl(urlStr)) {
      return false;
    }

    return (
      pathname.includes('/login') ||
      pathname.includes('/oauth') ||
      pathname.includes('/dialog/oauth') ||
      pathname.includes('/checkpoint') ||
      pathname.includes('/two_step_verification') ||
      pathname.includes('/recover') ||
      hostname.startsWith('login.') ||
      hostname.startsWith('auth.')
    );
  } catch {
    return false;
  }
}

/**
 * Checks if a URL is a Messenger/Facebook video or voice call window
 */
export function isCallUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const pathname = parsed.pathname.toLowerCase();
    return (
      pathname.includes('/videocall/') ||
      pathname.includes('/groupcall/') ||
      pathname.includes('/call/') ||
      pathname.includes('/meetup/')
    );
  } catch {
    return false;
  }
}

/**
 * Configures navigation safeguards and OAuth window interception for a window or WebContentsView.
 */
export function setupAuthAndNavigationHandlers(
  target: BrowserWindow | { webContents: import('electron').WebContents },
  sessionPartition: string,
  parentWindow?: BrowserWindow
): void {
  const contents = target.webContents;
  const modalParent = parentWindow || (target instanceof BrowserWindow ? target : undefined);

  // 1. Intercept new window requests (window.open / target="_blank")
  contents.setWindowOpenHandler((details: HandlerDetails): WindowOpenHandlerResponse => {
    const { url } = details;

    // 0. Handle about:blank or empty urls safely without launching external browser
    if (!url || url.startsWith('about:')) {
      return { action: 'allow' };
    }

    // Check if the target is an internal call window
    if (isCallUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          parent: modalParent,
          modal: false,
          autoHideMenuBar: true,
          webPreferences: {
            partition: sessionPartition,
            nodeIntegration: false,
            contextIsolation: true,
            backgroundThrottling: false
          }
        }
      };
    }

    // Check if the target is an OAuth dialog or Facebook login modal
    if (isAuthUrl(url)) {
      // Open a dedicated child auth modal to handle 2FA/OAuth cleanly
      if (modalParent) {
        createOAuthChildModal(modalParent, url, sessionPartition, contents);
      } else {
        contents.loadURL(url);
      }
      return { action: 'deny' };
    }

    // If it's directly a Messenger conversation navigation (e.g. /t/threadId)
    try {
      const parsed = new URL(url);
      if (parsed.hostname.includes('messenger.com') && (parsed.pathname === '/' || parsed.pathname.startsWith('/t/'))) {
        contents.loadURL(url);
        return { action: 'deny' };
      }
    } catch {}

    // For all external links or Facebook profile/post links opened in a new tab:
    // Open in default browser so the active chat view is never hijacked or destroyed!
    shell.openExternal(url).catch((err) => {
      console.error('Failed to open external URL:', url, err);
    });

    return { action: 'deny' };
  });

  // 2. Intercept in-page navigation (e.g. clicking a link or form submission)
  contents.on('will-navigate', (event, navigationUrl) => {
    if (!isAllowedInternalUrl(navigationUrl)) {
      event.preventDefault();
      shell.openExternal(navigationUrl).catch((err) => {
        console.error('Failed to open external navigation URL:', navigationUrl, err);
      });
    }
  });

  // 3. Intercept redirect chains
  contents.on('will-redirect', (event, redirectUrl) => {
    if (!isAllowedInternalUrl(redirectUrl)) {
      event.preventDefault();
      shell.openExternal(redirectUrl).catch((err) => {
        console.error('Failed to open external redirect URL:', redirectUrl, err);
      });
    }
  });
}

/**
 * Creates a focused child modal for OAuth authentication and 2FA checkpoints.
 * Automatically synchronizes session cookies and closes upon successful redirect back to Messenger.
 */
function createOAuthChildModal(
  parentWindow: BrowserWindow,
  authUrl: string,
  sessionPartition: string,
  targetContents?: import('electron').WebContents
): BrowserWindow {
  const authModal = new BrowserWindow({
    parent: parentWindow,
    modal: true,
    width: 600,
    height: 720,
    minWidth: 450,
    minHeight: 550,
    title: 'Log in with Facebook',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      partition: sessionPartition,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  authModal.once('ready-to-show', () => {
    authModal.show();
    authModal.focus();
  });

  const checkRedirect = (url: string) => {
    try {
      const parsed = new URL(url);
      const isMessengerHome =
        parsed.hostname.includes('messenger.com') &&
        (parsed.pathname === '/' || parsed.pathname.startsWith('/t/'));
      const isBusinessHome =
        parsed.hostname.includes('business.facebook.com') ||
        (parsed.hostname.includes('facebook.com') && (parsed.pathname.includes('/inbox') || parsed.pathname.includes('/messages')));

      // If redirect returns to Messenger or Business Suite, authentication was successful
      if (isMessengerHome || isBusinessHome || url.includes('close.html')) {
        if (!authModal.isDestroyed()) {
          authModal.close();
        }
        if (targetContents && !targetContents.isDestroyed()) {
          targetContents.loadURL(url);
        } else {
          parentWindow.loadURL(url);
        }
      }
    } catch (err) {
      console.error('Error parsing OAuth redirect:', err);
    }
  };

  authModal.webContents.on('will-navigate', (_e, url) => {
    checkRedirect(url);
  });

  authModal.webContents.on('will-redirect', (_e, url) => {
    checkRedirect(url);
  });

  authModal.webContents.on('did-navigate', (_e, url) => {
    checkRedirect(url);
  });

  authModal.loadURL(authUrl);

  return authModal;
}
