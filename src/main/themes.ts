import { BrowserWindow, nativeTheme } from 'electron';
import { ThemeId, ThemeDefinition } from '../types';

export const THEMES: Record<ThemeId, ThemeDefinition> = {
  'dark-midnight': {
    id: 'dark-midnight',
    name: 'Midnight Navy',
    category: 'dark',
    description: 'Deep slate navy with Messenger signature electric blue',
    previewColors: {
      bg: '#18191a',
      card: '#242526',
      accent: '#0084ff',
      text: '#e4e6eb'
    }
  },
  'dark-oled': {
    id: 'dark-oled',
    name: 'OLED Pitch Black',
    category: 'dark',
    description: 'True pitch black with high-contrast cyan for OLED displays',
    previewColors: {
      bg: '#000000',
      card: '#121212',
      accent: '#00e5ff',
      text: '#f5f5f7'
    }
  },
  'dark-cyberpunk': {
    id: 'dark-cyberpunk',
    name: 'Cyberpunk Neon',
    category: 'dark',
    description: 'Futuristic violet twilight with vibrant neon magenta accents',
    previewColors: {
      bg: '#13111c',
      card: '#1e192b',
      accent: '#e040fb',
      text: '#ece6fa'
    }
  },
  'light-clean': {
    id: 'light-clean',
    name: 'Clean Classic',
    category: 'light',
    description: 'Crisp bright snow white with signature electric blue',
    previewColors: {
      bg: '#ffffff',
      card: '#f0f2f5',
      accent: '#0084ff',
      text: '#050505'
    }
  },
  'light-sepia': {
    id: 'light-sepia',
    name: 'Warm Sepia',
    category: 'light',
    description: 'Gentle warm parchment tones, relaxing and easy on the eyes',
    previewColors: {
      bg: '#faf5eb',
      card: '#f2eae0',
      accent: '#d96b27',
      text: '#3d352e'
    }
  },
  'light-nordic': {
    id: 'light-nordic',
    name: 'Nordic Frost',
    category: 'light',
    description: 'Crisp arctic ice white with cool emerald teal accents',
    previewColors: {
      bg: '#f0f7f7',
      card: '#e2efef',
      accent: '#0d9488',
      text: '#1e293b'
    }
  }
};

export const THEME_LIST: ThemeDefinition[] = Object.values(THEMES);

export function getTheme(id: ThemeId): ThemeDefinition {
  return THEMES[id] || THEMES['dark-midnight'];
}

/**
 * Generates custom CSS overrides for Messenger web application matching the theme palette.
 */
export function generateThemeCss(theme: ThemeDefinition): string {
  const isDark = theme.category === 'dark';
  const { bg, card, accent, text } = theme.previewColors;

  const cardSecondary = isDark
    ? adjustBrightness(card, 15)
    : adjustBrightness(card, -5);
  const textSecondary = isDark
    ? '#a8b3cf'
    : '#65676b';
  const hoverOverlay = isDark
    ? 'rgba(255, 255, 255, 0.08)'
    : 'rgba(0, 0, 0, 0.05)';
  const border = isDark
    ? 'rgba(255, 255, 255, 0.1)'
    : 'rgba(0, 0, 0, 0.1)';
  const selectionBg = hexToRgba(accent, 0.28);
  const scrollbarThumb = isDark
    ? 'rgba(255, 255, 255, 0.22)'
    : 'rgba(0, 0, 0, 0.22)';
  const scrollbarHover = isDark
    ? 'rgba(255, 255, 255, 0.4)'
    : 'rgba(0, 0, 0, 0.4)';

  return `
    /* ====================================================================
       Messenger Desktop Custom Theme: ${theme.name} (${theme.id})
       ==================================================================== */
    :root, html, body, .__fb-light-mode, .__fb-dark-mode {
      --web-wash: ${bg} !important;
      --surface-background: ${card} !important;
      --secondary-surface-background: ${cardSecondary} !important;
      --hover-overlay: ${hoverOverlay} !important;
      --primary-text: ${text} !important;
      --secondary-text: ${textSecondary} !important;
      --primary-button-background: ${accent} !important;
      --primary-icon: ${accent} !important;
      --secondary-icon: ${textSecondary} !important;
      --divider: ${border} !important;
      --wash: ${bg} !important;
      --card-background: ${card} !important;
      --card-background-flat: ${card} !important;
      --messenger-card-background: ${card} !important;
      --comment-background: ${cardSecondary} !important;
      --popover-background: ${card} !important;
      --nav-bar-background: ${bg} !important;
      --search-background: ${cardSecondary} !important;
      --always-dark-overlay: rgba(0, 0, 0, 0.4) !important;
      --accent-color: ${accent} !important;
    }

    body, html {
      background-color: ${bg} !important;
      color: ${text} !important;
    }

    /* Selection Color */
    ::selection {
      background-color: ${selectionBg} !important;
      color: ${isDark ? '#ffffff' : '#000000'} !important;
    }

    /* Scrollbars */
    ::-webkit-scrollbar {
      width: 9px !important;
      height: 9px !important;
    }
    ::-webkit-scrollbar-track {
      background: transparent !important;
    }
    ::-webkit-scrollbar-thumb {
      background: ${scrollbarThumb} !important;
      border-radius: 6px !important;
      border: 2px solid transparent !important;
      background-clip: padding-box !important;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: ${scrollbarHover} !important;
      background-clip: padding-box !important;
    }

    /* Messenger Desktop Accent Details */
    a, a:hover, a:visited {
      color: ${accent} !important;
    }

    /* Left Navigation & Chat List Container */
    div[role="navigation"] {
      background-color: ${bg} !important;
      border-right: 1px solid ${border} !important;
    }

    /* Top Banner / Header */
    div[role="banner"] {
      background-color: ${bg} !important;
      border-bottom: 1px solid ${border} !important;
    }

    /* Main Chat Content Area */
    div[role="main"] {
      background-color: ${bg} !important;
    }

    /* Message Input Box */
    div[role="main"] div[role="region"] {
      background-color: ${bg} !important;
    }
  `;
}

function hexToRgba(hex: string, alpha: number): string {
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.substring(0, 2), 16) || 0;
  const g = parseInt(cleanHex.substring(2, 4), 16) || 0;
  const b = parseInt(cleanHex.substring(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function adjustBrightness(hex: string, percent: number): string {
  const cleanHex = hex.replace('#', '');
  let r = parseInt(cleanHex.substring(0, 2), 16) || 0;
  let g = parseInt(cleanHex.substring(2, 4), 16) || 0;
  let b = parseInt(cleanHex.substring(4, 6), 16) || 0;

  r = Math.min(255, Math.max(0, r + percent));
  g = Math.min(255, Math.max(0, g + percent));
  b = Math.min(255, Math.max(0, b + percent));

  const rr = r.toString(16).padStart(2, '0');
  const gg = g.toString(16).padStart(2, '0');
  const bb = b.toString(16).padStart(2, '0');
  return `#${rr}${gg}${bb}`;
}

let lastInjectedKey: string | null = null;

/**
 * Applies the requested theme to the main window webContents and native window chrome.
 */
export async function applyTheme(mainWindow: BrowserWindow, themeId: ThemeId): Promise<void> {
  if (mainWindow.isDestroyed()) return;

  const theme = getTheme(themeId);
  const isDark = theme.category === 'dark';

  // Sync native theme source so webview recognizes dark/light base
  nativeTheme.themeSource = isDark ? 'dark' : 'light';

  // Update window background
  mainWindow.setBackgroundColor(theme.previewColors.bg);

  // Generate and inject theme CSS
  const css = generateThemeCss(theme);

  try {
    if (lastInjectedKey) {
      await mainWindow.webContents.removeInsertedCSS(lastInjectedKey);
    }
  } catch {
    // key might be invalid or invalidated on page reload
  }

  try {
    lastInjectedKey = await mainWindow.webContents.insertCSS(css);
  } catch (err) {
    console.error('Failed to inject theme CSS:', err);
  }

  // Notify renderer
  mainWindow.webContents.send('theme-applied', {
    themeId: theme.id,
    theme
  });
  mainWindow.webContents.send('theme-changed', isDark);
}
