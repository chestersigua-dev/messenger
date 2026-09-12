# Messenger Desktop for Windows

A high-performance, open-source Windows 10/11 desktop client wrapper for **Messenger** (`https://www.messenger.com/`). Designed to faithfully restore and enhance the standalone desktop experience of the discontinued official client with native system integration, hardware acceleration, background notification management, and WebRTC audio/video calling.

---

## Features

- **Seamless Facebook OAuth & 2FA**:
  - Handles Facebook OAuth redirects and two-step verification checkpoints cleanly within isolated child modals or the primary session partition.
  - Whitelist enforcement (`*.facebook.com`, `*.messenger.com`, `*.fbcdn.net`) prevents breaking the authentication loop while routing external links securely to your default Windows web browser (`shell.openExternal`).
  - Persistent session partition (`persist:messenger_session`) maintains login state, cookies, and local cache across system reboots.

- **Native WebRTC Audio & Video Calling**:
  - Automatic permission delegation for camera, microphone, screen capture, and full-screen calling inside `session.setPermissionRequestHandler`.
  - Background throttling disabled (`backgroundThrottling: false`) to ensure crystal-clear, uninterrupted call audio even when minimized.
  - Dedicated call popup handling and Picture-in-Picture (PiP) support.

- **Dynamic Taskbar Badge & Notifications**:
  - Native Windows 10/11 Action Center notification integration using Windows AppUserModelID (`com.messenger.desktop`).
  - Real-time unread message badge count rendered dynamically on the Windows taskbar icon via `mainWindow.setOverlayIcon`.
  - Taskbar flashing (`mainWindow.flashFrame(true)`) when new messages arrive.
  - Clicking notifications immediately restores, unminimizes, and focuses the target conversation.

- **System Tray & Background Management**:
  - Minimize-to-tray behavior preserves background notifications and ongoing call connectivity on window close.
  - Responsive tray icon with real-time unread indicators.
  - Context menu with options: Open Messenger, Mute Notifications, Reload, Clear Cache, and Quit.
  - Global hotkeys (`Ctrl+Shift+M` to toggle visibility, `Ctrl+Shift+N` to toggle mute).

- **Modern Windows Design & Theme Sync**:
  - Automatic synchronization with Windows Light/Dark theme preference (`nativeTheme.shouldUseDarkColors`).
  - Custom Windows Fluent scrollbars and hardware-accelerated GPU rendering.

- **Packaging & CI/CD**:
  - Automated NSIS setup installer (`Messenger-Setup-1.0.0-x64.exe`) with custom installation directory support and desktop/Start menu shortcuts.
  - Portable standalone executable (`Messenger-Portable-1.0.0-x64.exe`).
  - Ready-to-use GitHub Actions workflow (`.github/workflows/release.yml`) for tag-based automated builds and release asset publishing with SHA256 checksums.

---

## Project Structure

```text
messenger/
├── .github/
│   └── workflows/
│       └── release.yml          # GitHub Actions automated release pipeline
├── assets/
│   ├── icon.ico                 # Multi-resolution Windows app icon (16-256px)
│   ├── icon.png                 # High-resolution PNG logo
│   ├── icon.svg                 # Vector source logo
│   └── tray.ico                 # System tray icon
├── scripts/
│   └── generate-icons.js        # Multi-resolution icon generation script
├── src/
│   ├── main/
│   │   ├── auth.ts              # Facebook OAuth, navigation guards & URL whitelist
│   │   ├── badge.ts             # Windows taskbar unread counter overlay
│   │   ├── main.ts              # Electron main process entry & lifecycle
│   │   ├── media.ts             # WebRTC device permissions & screen sharing
│   │   ├── notifications.ts     # Native Windows notifications & AppUserModelId
│   │   ├── shortcuts.ts         # Global hotkeys & keyboard accelerators
│   │   └── tray.ts              # System tray integration & minimize-to-tray
│   ├── preload/
│   │   └── preload.ts           # HTML5 Notification hook, DOM/title observer, IPC bridge
│   └── types/
│       └── index.ts             # TypeScript interfaces and IPC channel contracts
├── electron-builder.yml         # NSIS & portable packaging configuration
├── package.json                 # Scripts and dependencies
├── tsconfig.json                # Strict TypeScript configuration
└── vite.config.ts               # Vite build configuration for Electron
```

---

## Prerequisites

- **Node.js**: v18.0.0 or higher (v20+ recommended)
- **npm**: v9.0.0 or higher
- **OS**: Windows 10 / Windows 11 (64-bit)

---

## Getting Started Locally

### 1. Clone the Repository
```bash
git clone https://github.com/chestersigua-dev/messenger.git
cd messenger
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Generate Application Icons
Generate the multi-resolution `.ico` and `.png` assets:
```bash
npm run build:icon
```

### 4. Run in Development Mode
Launch the application locally with hot-reloading:
```bash
npm run dev
```

---

## Building Installers

### Build Distribution Binaries
To compile TypeScript and package both the NSIS setup installer and the Portable executable:
```bash
npm run dist
```

Artifacts will be output to the `release/` directory:
- `release/Messenger-Setup-1.0.0-x64.exe` (NSIS Installer)
- `release/Messenger-Portable-1.0.0-x64.exe` (Standalone Portable)

### Target Specific Builds
- **NSIS Installer Only:**
  ```bash
  npm run dist:nsis
  ```
- **Portable Executable Only:**
  ```bash
  npm run dist:portable
  ```
- **Unpacked Directory (for fast local testing):**
  ```bash
  npm run pack
  ```

---

## GitHub Actions Release Setup

1. Push your repository to GitHub.
2. In your repository settings, ensure GitHub Actions has **Read and write permissions** under **Settings > Actions > General > Workflow permissions**.
3. Create and push a version tag:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
4. The `.github/workflows/release.yml` workflow will automatically:
   - Check out code and install dependencies.
   - Compile TypeScript and Vite bundles.
   - Build both the NSIS installer and Portable `.exe`.
   - Calculate SHA256 checksums (`checksums.sha256`).
   - Create a published GitHub Release and attach all binaries.

---

## Security Architecture

- **Isolated Context**: `contextIsolation: true` is strictly enforced, and `nodeIntegration: false` ensures external web pages cannot access Node.js primitives.
- **Sanitized Bridge**: Only vetted IPC methods (`sendNotification`, `updateUnreadCount`, `onThemeChanged`) are exposed through `contextBridge`.
- **Navigation Safeguards**: External links clicked inside chat conversations are intercepted and routed to the system's default browser via `shell.openExternal`, protecting users against phishing and cross-site scripting risks.

---

## License

This project is open-source software licensed under the [MIT License](LICENSE).
Messenger and Facebook are trademarks of Meta Platforms, Inc. This application is an unofficial open-source wrapper.
