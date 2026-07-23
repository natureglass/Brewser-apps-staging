// Deterministic package walker. Reads the whole unpacked app tree, classifies
// every file by extension, and computes a stable sha256 of the tree (sorted
// path + content) so the same package always hashes the same regardless of
// filesystem walk order.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const KIND = {
  JS: 'js',
  HTML: 'html',
  JSON: 'json',
  CSS: 'css',
  SVG: 'svg',
  OTHER: 'other',
};

function classify(relPath) {
  const ext = path.extname(relPath).toLowerCase();
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return KIND.JS;
  if (ext === '.html' || ext === '.htm') return KIND.HTML;
  if (ext === '.svg') return KIND.SVG;
  if (ext === '.json') return KIND.JSON;
  if (ext === '.css') return KIND.CSS;
  return KIND.OTHER;
}

// Extensions we read as text for the JS/HTML/CSS analyzers. Everything else is
// handled as a binary buffer by the asset analyzer (entropy + magic bytes).
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.html', '.htm', '.svg', '.json', '.css', '.txt', '.md', '.xml']);

async function walkDir(root, dir, out) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const ent of entries) {
    const abs = path.join(dir, ent.name);
    if (ent.isSymbolicLink()) continue; // safe_unzip already rejects these; defensive
    if (ent.isDirectory()) {
      await walkDir(root, abs, out);
    } else if (ent.isFile()) {
      const rel = path.relative(root, abs).split(path.sep).join('/');
      const buffer = await fs.readFile(abs);
      const ext = path.extname(rel).toLowerCase();
      out.push({
        rel,
        abs,
        ext,
        kind: classify(rel),
        size: buffer.length,
        buffer,
        isText: TEXT_EXT.has(ext),
        text: TEXT_EXT.has(ext) ? buffer.toString('utf8') : null,
      });
    }
  }
}

export async function walkPackage(root) {
  const files = [];
  await walkDir(root, root, files);
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  const hash = crypto.createHash('sha256');
  for (const f of files) {
    hash.update(f.rel, 'utf8');
    hash.update('\0');
    hash.update(f.buffer);
    hash.update('\0');
  }
  return { files, packageHash: hash.digest('hex') };
}
