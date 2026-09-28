import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `--mode standalone` で three.js ごと 1 ファイルの HTML に束ねる（配布・閲覧用）。
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'standalone' ? [viteSingleFile()] : [],
  build: {
    outDir: mode === 'standalone' ? 'dist-standalone' : 'dist',
    chunkSizeWarningLimit: 2000,
    target: 'es2022',
  },
}));
