import { Session, desktopCapturer } from 'electron';

/**
 * Permitted WebRTC and browser permissions for Messenger and Facebook
 */
const GRANTED_PERMISSIONS = new Set([
  'media',
  'mediaKeySystem',
  'geolocation',
  'notifications',
  'midi',
  'midiSysex',
  'pointerLock',
  'fullscreen',
  'display-capture',
  'clipboard-read',
  'clipboard-sanitized-write'
]);

/**
 * Configures session permissions and WebRTC handling for audio/video calling.
 */
export function setupMediaAndPermissions(customSession: Session): void {
  // 1. Automatic permission request granting for whitelisted domains
  customSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const url = details?.requestingUrl || webContents.getURL();
    
    try {
      const parsed = new URL(url);
      const isInternalDomain =
        parsed.hostname.endsWith('messenger.com') ||
        parsed.hostname.endsWith('facebook.com') ||
        parsed.hostname.endsWith('fbcdn.net');

      if (isInternalDomain && GRANTED_PERMISSIONS.has(permission)) {
        callback(true);
        return;
      }
    } catch {
      // invalid URL
    }

    // Default deny for unknown origins or unlisted permissions
    callback(false);
  });

  // 2. Synchronous permission check handler
  customSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    try {
      const parsed = new URL(requestingOrigin);
      const isInternalDomain =
        parsed.hostname.endsWith('messenger.com') ||
        parsed.hostname.endsWith('facebook.com') ||
        parsed.hostname.endsWith('fbcdn.net');

      return isInternalDomain && GRANTED_PERMISSIONS.has(permission);
    } catch {
      return false;
    }
  });

  // 3. Screen and window capture handling for screen sharing during video calls
  customSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        fetchWindowIcons: true
      });

      // Default to the primary screen or the first window available
      if (sources.length > 0) {
        callback({ video: sources[0] });
      } else {
        callback({});
      }
    } catch (err) {
      console.error('Error handling display media request:', err);
      callback({});
    }
  });

  // 4. Ensure WebRTC audio output selection is enabled
  customSession.setBluetoothPairingHandler?.((_details, callback) => {
    callback({ response: 'cancel' });
  });
}
