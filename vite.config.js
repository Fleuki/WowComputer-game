import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Сборка в один HTML-файл: игру можно открыть двойным кликом без сервера.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: {
    outDir: 'play',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
  },
});
