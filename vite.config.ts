import { defineConfig } from 'vite';
import electron from 'vite-plugin-electron';
import path from 'path';

export default defineConfig({
  plugins: [
    electron([
      {
        // Main process entry file of the Electron App.
        entry: 'src/main/main.ts',
        onstart(options) {
          options.startup();
        },
        vite: {
          build: {
            outDir: 'dist/main',
            sourcemap: true,
            minify: false,
            rollupOptions: {
              external: ['electron', 'path', 'fs', 'url', 'os', 'child_process']
            }
          }
        }
      },
      {
        entry: 'src/preload/preload.ts',
        onstart(options) {
          // Notify the Renderer process to reload the page when the Preload scripts build is complete
          options.reload();
        },
        vite: {
          build: {
            outDir: 'dist/preload',
            sourcemap: true,
            minify: false,
            rollupOptions: {
              external: ['electron']
            }
          }
        }
      },
      {
        entry: 'src/preload/tabbar-preload.ts',
        vite: {
          build: {
            outDir: 'dist/preload',
            sourcemap: true,
            minify: false,
            rollupOptions: {
              external: ['electron']
            }
          }
        }
      }
    ])
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  }
});
