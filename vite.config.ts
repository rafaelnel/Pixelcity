import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    base: './',
    plugins: [
      react(),
      tailwindcss(),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
          // Ensure GitHub Pages files (.nojekyll and 404.html fallback) are always present in dist/
          if (fs.existsSync(distDir)) {
            fs.writeFileSync(path.resolve(distDir, '.nojekyll'), '');
            const distIndex = path.resolve(distDir, 'index.html');
            if (fs.existsSync(distIndex)) {
              fs.copyFileSync(distIndex, path.resolve(distDir, '404.html'));
            }
            // Mirror compiled bundle to public/bundle/ so even raw main-branch GitHub Pages works
            const builtAssetsDir = path.resolve(distDir, 'assets');
            if (fs.existsSync(builtAssetsDir)) {
              const files = fs.readdirSync(builtAssetsDir);
              const jsFile = files.find((f) => f.startsWith('index-') && f.endsWith('.js'));
              const cssFile = files.find((f) => f.startsWith('index-') && f.endsWith('.css'));
              const fallbackDir = path.resolve(__dirname, 'public/bundle');
              fs.mkdirSync(fallbackDir, {recursive: true});
              if (jsFile) {
                fs.copyFileSync(
                  path.resolve(builtAssetsDir, jsFile),
                  path.resolve(fallbackDir, 'app.js')
                );
              }
              if (cssFile) {
                fs.copyFileSync(
                  path.resolve(builtAssetsDir, cssFile),
                  path.resolve(fallbackDir, 'app.css')
                );
              }
            }
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
