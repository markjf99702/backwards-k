// Bundles the app into one self-contained HTML file, dist/backwards-k.html, for sharing as a single page.
// Also writes dist/artifact.html, the same page without the document wrapper,
// for hosts that supply their own <html>/<head>/<body>. The repo itself runs without this step.
// The single file hides backups, files and printing where it's shown inside another page, which can't do them,
// and Google Drive, which only works at backwards-k.junkdrawer.works.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const read = p => readFile(new URL(p, root), 'utf8');

const result = await build({
  entryPoints: [new URL('js/app.js', root).pathname],
  bundle: true,
  format: 'iife',
  minify: true,
  target: 'es2020',
  write: false,
});
// data-single tells the page it's the one-file copy: no service worker, and no downloads inside another page.
const js = `document.documentElement.dataset.single = '';\n${result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}`;

// Pages shown inside a host that has its own light/dark switch get data-theme on <html>: follow the system
// setting unless it says light, and go dark when it says dark. Every dark rule gets both, not only the palette.
function guardDark(css) {
  const open = '@media (prefers-color-scheme: dark) {';
  const split = sel => {
    const out = [];
    let depth = 0, cur = '';
    for (const ch of sel) {
      if (ch === '(' || ch === '[') depth++;
      if (ch === ')' || ch === ']') depth--;
      if (ch === ',' && !depth) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    return [...out, cur.trim()];
  };
  const scope = (rules, guard) => rules.map(r => `${split(r.sel).map(s => (s === ':root' ? guard : `${guard} ${s}`)).join(', ')} {${r.body}}`).join('\n');
  let out = '', at = 0, blocks = 0;
  for (let i = css.indexOf(open); i >= 0; i = css.indexOf(open, at)) {
    let depth = 0, end = i + open.length - 1;
    for (; end < css.length; end++) {
      if (css[end] === '{') depth++;
      else if (css[end] === '}' && --depth === 0) break;
    }
    const rules = [...css.slice(i + open.length, end).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ sel: m[1].trim(), body: m[2] }));
    out += `${css.slice(at, i)}${open}\n${scope(rules, ':root:not([data-theme="light"])')}\n}\n${scope(rules, ':root[data-theme="dark"]')}`;
    at = end + 1;
    blocks++;
  }
  if (blocks < 6) throw new Error(`css/app.css: expected the palette and five more dark rules, found ${blocks}`);
  return out + css.slice(at);
}

// A single file can't point at other files, so the font and the icon go in as data: URIs,
// and the links that only make sense for the hosted site (manifest, home-screen icon, preload) come out.
const dataUri = async (path, type) => `data:${type};base64,${(await readFile(new URL(path, root))).toString('base64')}`;
let css = guardDark(await read('css/app.css'));
for (const [, file] of css.matchAll(/url\(\.\.\/(fonts\/[^)]+\.woff2)\)/g)) css = css.replace(`url(../${file})`, `url(${await dataUri(file, 'font/woff2')})`);
const icon = await dataUri('icon.svg', 'image/svg+xml');
const page = css => (html => html
  .replace(/ *<link rel="(manifest|apple-touch-icon|preload)"[^>]*>\n/g, '')
  .replaceAll('"icon.svg"', () => `"${icon}"`)
  .replace('<link rel="stylesheet" href="css/app.css">', () => `<style>\n${css}</style>`)
  .replace(/ *<script type="module" src="js\/app.js"><\/script>\n/, '')
  .replace('</body>', () => `<script>\n${js}</script>\n</body>`));
const source = await read('index.html');
const html = page(css)(source);
if (/(src|href)="(js|css|fonts)\/|"icon-\d|manifest\.webmanifest/.test(html)) throw new Error('index.html: a link to another file was left in');

// That host pads the page clear of a phone's notch itself, so the sticky header sits below the padding
// instead of adding its own.
const hostCss = css
  .replace('position: sticky; top: 0; z-index: 20;', 'position: sticky; top: env(safe-area-inset-top, 0px); z-index: 20;')
  .replace('\n  padding-top: env(safe-area-inset-top);\n', '\n');
if (hostCss.includes('padding-top: env(safe-area-inset-top);') || !hostCss.includes('top: env(safe-area-inset-top, 0px)')) throw new Error('css/app.css: the header’s sticky and padding rules weren’t found');
const fragment = page(hostCss)(source)
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<\/?html[^>]*>\s*/gi, '')
  .replace(/<\/?head>\s*/gi, '')
  .replace(/<\/?body[^>]*>\s*/gi, '')
  .replace(/<meta charset[^>]*>\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '');

await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/backwards-k.html', root), html);
await writeFile(new URL('dist/artifact.html', root), fragment);
console.log(`dist/backwards-k.html  ${(html.length / 1024).toFixed(1)} KB`);
console.log(`dist/artifact.html    ${(fragment.length / 1024).toFixed(1)} KB`);
