import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `--mode standalone` で three.js ごと 1 ファイルの HTML に束ねる（配布・閲覧用）。
// Blender の出力（src/assets の画像・HDR）も data URI で埋め込み、外部ファイルを残さない。
// 通常ビルドでは 4KB を超えるアセットは dist/assets に別ファイルとして出力する。
export default defineConfig(({ mode }) => {
  const standalone = mode === 'standalone';
  return {
    base: './',
    plugins: standalone ? [viteSingleFile()] : [],
    build: {
      outDir: standalone ? 'dist-standalone' : 'dist',
      assetsInlineLimit: standalone ? () => true : 4096,
      chunkSizeWarningLimit: 2000,
      target: 'es2022',
    },
  };
});
