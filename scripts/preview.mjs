// A local preview of the static pages, the way Vercel serves them (cleanUrls: /nb/saldo-pocket/privacy → .html).
// Nothing is published; the language middleware does not run here (an address without a language shows the English
// fallback page). Stop with Ctrl-C.
//   npm run preview              http://localhost:4173
//   PORT=5000 npm run preview
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT ?? 4173);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.woff2': 'font/woff2' };

http
  .createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const base = path.join(root, path.normalize(url).replace(/^(\.\.[/\\])+/, ''));
    const file = [base, `${base}.html`, path.join(base, 'index.html')].find((f) => f.startsWith(root) && fs.existsSync(f) && fs.statSync(f).isFile());
    if (!file || file.includes(`${path.sep}node_modules${path.sep}`)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, '127.0.0.1', () => console.log(`Preview: http://localhost:${port}/nb/privacy (Ctrl-C to stop)`));
