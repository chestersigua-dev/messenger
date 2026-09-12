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
 * Configures navigation safeguards and OAuth window interception for the main window.
 */
export function setupAuthAndNavigationHandlers(
  mainWindow: BrowserWindow,
  sessionPartition: string
): void {
  const contents = mainWindow.webContents;

  // 1. Intercept new window requests (window.open / target="_blank")
  contents.setWindowOpenHandler((details: HandlerDetails): WindowOpenHandlerResponse => {
    const { url } = details;

    // Check if the target is an internal call window
    if (isCallUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          parent: mainWindow,
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
      createOAuthChildModal(mainWindow, url, sessionPartition);
      return { action: 'deny' };
    }

    // If internal Messenger or Facebook link that isn't auth/call
    if (isAllowedInternalUrl(url)) {
      // Navigate in main window
      mainWindow.loadURL(url);
      return { action: 'deny' };
    }

    // External URLs clicked in chat messages: open in default system browser
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
  sessionPartition: string
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

      // If redirect returns to Messenger, authentication was successful
      if (isMessengerHome || url.includes('close.html')) {
        if (!authModal.isDestroyed()) {
          authModal.close();
        }
        parentWindow.loadURL(url);
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
