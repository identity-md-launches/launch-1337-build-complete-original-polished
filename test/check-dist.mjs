/**
 * Static integrity check of the export (no browser): manifest shape, entry and
 * cover present, relative asset URLs only, required head metadata.
 *   node test/check-dist.mjs
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
};

const manifest = JSON.parse(await readFile(path.join(dist, 'pepe-game.json'), 'utf8'));
ok(manifest.schemaVersion === 'pepe-browser-game/1', 'schemaVersion is pepe-browser-game/1');
ok(typeof manifest.title === 'string' && manifest.title.length >= 2 && manifest.title.length <= 60, 'title 2-60 chars');
ok(/^\d+\.\d+\.\d+$/.test(manifest.version), 'version is numeric semver');
ok(manifest.summary.length >= 10 && manifest.summary.length <= 160, 'summary 10-160 chars');
ok(manifest.description.length >= 10 && manifest.description.length <= 2000, 'description 10-2000 chars');
ok(manifest.controls.length >= 5 && manifest.controls.length <= 500, 'controls 5-500 chars');
ok(['arcade', 'puzzle', 'action', 'strategy', 'casual'].includes(manifest.genre), 'genre is allowed');
ok(manifest.players === 1 && manifest.mobile === true, 'players 1, mobile true');
const relative = (p) => typeof p === 'string' && !p.startsWith('/') && !p.includes('..') && !/^[a-z]+:/i.test(p) && !p.includes('?');
ok(relative(manifest.entry) && relative(manifest.cover), 'entry and cover are relative paths');
for (const file of [manifest.entry, manifest.cover, 'favicon.svg']) {
  const info = await stat(path.join(dist, file)).catch(() => null);
  ok(info?.isFile(), `dist/${file} exists`);
}
const cover = await readFile(path.join(dist, manifest.cover));
ok(cover.readUInt32BE(16) === 1200 && cover.readUInt32BE(20) === 630, 'cover.png is 1200x630');

const html = await readFile(path.join(dist, 'index.html'), 'utf8');
ok(/<title>[^<]{3,}<\/title>/.test(html), 'index.html has a title');
ok(/<meta name="description" content="[^"]{10,}"/.test(html), 'index.html has a description');
ok(/<meta property="og:title" content="[^"]+"/.test(html), 'index.html has og:title');
ok(/<meta property="og:image" content="\.\/cover\.png"/.test(html), 'index.html has a relative og:image');
ok(/<link rel="icon" href="\.\/favicon\.svg"/.test(html), 'index.html links a favicon');
const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
ok(urls.every((u) => u.startsWith('./')), `all ${urls.length} src/href URLs are relative (./)`);
ok(!/type="module"|crossorigin/.test(html), 'no module/crossorigin script (sandbox-safe classic script)');
for (const u of urls) {
  const info = await stat(path.join(dist, u)).catch(() => null);
  ok(info?.isFile(), `referenced asset exists: ${u}`);
}
const css = await readFile(path.join(dist, urls.find((u) => u.endsWith('.css'))), 'utf8');
ok(!/url\((?!data:)/.test(css), 'stylesheet has no external url() (fonts inlined)');
ok(!/https?:\/\//.test(html), 'index.html loads nothing from the network');

console.log(failures ? `\n${failures} check(s) failed` : '\nall dist checks passed');
process.exitCode = failures ? 1 : 0;
