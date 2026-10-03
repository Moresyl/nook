import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { launch: 'desktop/launch.ts', 'attachment-worker': 'desktop/attachment-worker.ts' }, output: { format: 'cjs', entryFileNames: '[name].cjs' } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { bridge: 'desktop/bridge.ts', 'plugin-bridge': 'desktop/plugin-bridge.ts' }, output: { format: 'cjs', entryFileNames: '[name].cjs' } } },
  },
  renderer: {
    root: 'workbench',
    plugins: [react()],
    build: { rollupOptions: { input: 'workbench/index.html' } },
  },
});
