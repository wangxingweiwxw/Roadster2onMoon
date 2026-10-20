import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const project = resolve(root, 'roadster2-moon-cloudbase');
const built = process.argv.includes('--built');
const assets = resolve(project, built ? 'dist' : 'public');
const required = [
  'game.js', 'lib/three.module.min.js', 'lib/loaders/GLTFLoader.js',
  'src/camera-rig.js', 'src/base-physics.js', 'src/moonbase.js',
  'src/video-library.js', 'src/video-library.css', 'assets/Roadster2.glb',
  'assets/textures/regolith-color.jpg', 'assets/textures/regolith-normal.webp',
  'assets/textures/regolith-roughness.jpg',
  ...['xray', 'ceiling', 'launch', 'hover'].flatMap(name => [
    `assets/videos/${name}.mp4`, `assets/videos/${name}.jpg`,
  ]),
];
for (const path of required) {
  assert.ok(existsSync(resolve(assets, path)), `Missing runtime resource: ${path}`);
  assert.ok(statSync(resolve(assets, path)).size > 0, `Empty runtime resource: ${path}`);
}
const sourceHTML = readFileSync(resolve(project, 'index.html'), 'utf8');
assert.ok(sourceHTML.includes('__AIWORKS_EVENT_TRACKING_TICKET__'), 'Only an inert tracking placeholder belongs in source');
for (const file of ['README.md', 'docs/creation.md', 'docs/images/README.md']) {
  const path = resolve(root, file);
  for (const [, link] of readFileSync(path, 'utf8').matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    if (/^(https?:|#)/.test(link)) continue;
    assert.ok(existsSync(resolve(dirname(path), link.split('#')[0])), `Broken documentation link in ${file}: ${link}`);
  }
}
if (built) {
  const html = readFileSync(resolve(assets, 'index.html'), 'utf8');
  for (const [, path] of html.matchAll(/(?:src|href)="(\.[^"]+)"/g))
    assert.ok(existsSync(resolve(assets, path.split('?')[0])), `Broken built HTML asset: ${path}`);
  assert.ok(readdirSync(resolve(assets, '_build')).some(p => p.endsWith('.js')));
}
console.log(`Checked ${required.length} runtime resources, documentation links and ${built ? 'production build' : 'source'} inputs.`);
