import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    // Bundle startup JavaScript dependencies to avoid many synchronous module reads.
    // Native modules and document parsers retain their existing external loading.
    plugins: [externalizeDepsPlugin({ exclude: ['zod', '@modelcontextprotocol/sdk', 'yaml'] })],
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
