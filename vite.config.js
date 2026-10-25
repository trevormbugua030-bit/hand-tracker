import { defineConfig } from 'vite';
import { createReadStream, existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const wasmDirectory = path.join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const publicPrefix = '/mediapipe/wasm/';

export default defineConfig({
  plugins: [{
    name: 'serve-mediapipe-wasm-locally',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = request.url || '';
        if (!url.startsWith(publicPrefix)) return next();
        const filename = path.basename(decodeURIComponent(url.slice(publicPrefix.length).split('?')[0]));
        const filePath = path.join(wasmDirectory, filename);
        if (!existsSync(filePath)) return next();
        response.setHeader('Content-Type', filename.endsWith('.wasm') ? 'application/wasm' : 'text/javascript; charset=utf-8');
        createReadStream(filePath).pipe(response);
      });
    },
    generateBundle() {
      for (const filename of readdirSync(wasmDirectory)) {
        if (!filename.endsWith('.wasm') && !filename.endsWith('.js')) continue;
        this.emitFile({
          type: 'asset',
          fileName: `mediapipe/wasm/${filename}`,
          source: readFileSync(path.join(wasmDirectory, filename)),
        });
      }
    },
  }],
});
