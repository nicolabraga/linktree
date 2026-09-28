// Sincroniza os álbuns recentes do fotopix.com.br (fotógrafo 292380) com este repositório.
// Uso: node scripts/sync-fotopix.mjs linktree          -> atualiza links-data.js + index.html (repo nicolabraga/linktree)
//      node scripts/sync-fotopix.mjs nicolabragafoto   -> atualiza data/albums.json (repo nicolabraga/linktree-nicolabragafoto)
// Só grava arquivos quando há álbum novo; o workflow faz commit apenas se algo mudou.
import fs from 'node:fs';

const MODE = process.argv[2];
const ID_FOTO = 292380;
const LINKTREE_RAW = 'https://raw.githubusercontent.com/nicolabraga/linktree/main/links-data.js';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; linktree-sync/1.0)' };

const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Fortaleza', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
}).formatToParts(new Date()).map(x => [x.type, x.value]));
const TS = `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
const ISO = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}-03:00`;

async function get(url) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: HEADERS });
      if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
      return r;
    } catch (e) {
      if (i >= 3) throw e;
      await new Promise(res => setTimeout(res, 5000));
    }
  }
}

const decodeEntities = s => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');

async function listHrefs() {
  const y = +parts.year, m = +parts.month;
  const ids = [];
  for (let i = 0; i < 2; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const url = `https://fotopix.com.br/whitelabel/albuns_recentes.php?id_fotografo=${ID_FOTO}&ano=${d.getUTCFullYear()}&mes=${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const html = await (await get(url)).text();
    ids.push(...[...html.matchAll(/tela_album_white_label\((\d+)\)/g)].map(x => +x[1]));
  }
  if (!ids.length) throw new Error('Nenhum álbum encontrado na listagem do fotopix (página mudou ou bloqueou o acesso?)');
  return [...new Set(ids)].map(id => `https://fotopix.com.br/album/${id.toString(16)}`);
}

async function fetchTitle(href) {
  const r = await get(href);
  const buf = await r.arrayBuffer();
  const cs = (r.headers.get('content-type') || '').match(/charset=([^\s;]+)/i)?.[1] || 'utf-8';
  let html;
  try { html = new TextDecoder(cs).decode(buf); } catch { html = new TextDecoder('utf-8').decode(buf); }
  let t = decodeEntities((html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim());
  const cut = t.match(/^(.*?\d{2}\/{1,2}\d{2}\/\d{4})/);
  t = cut ? cut[1] : t.split(/\s*\|\s*|\s+-\s+Álbum de Fotos/)[0].trim();
  return t || href;
}

const parseLinks = text => JSON.parse(text.match(/window\.LINKS_DATA\s*=\s*(\{[\s\S]*\})\s*;/)[1]).links;

const buildJs = links => `// Gerado automaticamente por update_links.py\n// Fonte: https://fotopix.com.br/\n// Atualizado em: ${TS}\nwindow.LINKS_DATA = {\n  "updated_at": "${TS}",\n  "links": [\n${links.map(l => `    {"href": ${JSON.stringify(l.href)}, "text": ${JSON.stringify(l.text)}}`).join(',\n')}\n  ]\n};\n`;

const emojiFor = t => /Tarde\s*[|/]\s*Noite/i.test(t) ? '🌆' : /Washington Soares/i.test(t) ? '🛣' : /Circuito/i.test(t) ? '🏁'
  : /Beira Mar/i.test(t) ? '🌊' : /Sabiaguaba/i.test(t) ? '🚴' : /Track\s*&\s*Field/i.test(t) ? '🏃'
  : /Maratona/i.test(t) ? '🏅' : /Triathlon/i.test(t) ? '🏊' : '📷';

async function newLinksAgainst(knownHrefs) {
  const known = new Set(knownHrefs);
  const hrefs = (await listHrefs()).filter(h => !known.has(h));
  const out = [];
  for (const href of hrefs) out.push({ href, text: await fetchTitle(href) });
  return out;
}

if (MODE === 'linktree') {
  const existing = parseLinks(fs.readFileSync('links-data.js', 'utf8'));
  const fresh = await newLinksAgainst(existing.map(l => l.href));
  if (!fresh.length) { console.log('Nenhum álbum novo.'); process.exit(0); }
  const js = buildJs([...fresh, ...existing]);
  const index = fs.readFileSync('index.html', 'utf8');
  const newIndex = index.replace(/(<!-- LINKS_DATA_START -->\s*<script>\n)[\s\S]*?(<\/script>\s*<!-- LINKS_DATA_END -->)/, (_, a, b) => a + js + b);
  if (newIndex === index) throw new Error('Marcadores LINKS_DATA_START/END não encontrados no index.html');
  fs.writeFileSync('links-data.js', js);
  fs.writeFileSync('index.html', newIndex);
  console.log('Álbuns novos:\n' + fresh.map(l => '- ' + l.text).join('\n'));
} else if (MODE === 'nicolabragafoto') {
  const cache = parseLinks(await (await get(`${LINKTREE_RAW}?t=${Date.now()}`)).text());
  const current = JSON.parse(fs.readFileSync('data/albums.json', 'utf8'));
  const oldEmoji = Object.fromEntries(current.albums.map(a => [a.id, a.emoji]));
  const fresh = await newLinksAgainst(cache.map(l => l.href));
  const albums = [...fresh, ...cache].slice(0, 15).map(l => {
    const id = l.href.split('/').pop();
    const dm = l.text.match(/(\d{2})\/{1,2}(\d{2})\/(\d{4})/);
    const date = dm ? `${dm[1]}/${dm[2]}/${dm[3]}` : '';
    const title = (dm ? l.text.slice(0, dm.index) : l.text).replace(/[\s\-–]+$/, '').trim();
    return { id, emoji: oldEmoji[id] || emojiFor(l.text), title, date, url: l.href };
  });
  if (JSON.stringify(albums) === JSON.stringify(current.albums)) { console.log('Nenhum álbum novo.'); process.exit(0); }
  fs.writeFileSync('data/albums.json', JSON.stringify({ updatedAt: ISO, albums }, null, 2) + '\n');
  const added = albums.filter(a => !(a.id in oldEmoji));
  console.log('Álbuns novos no site:\n' + added.map(a => `- ${a.title} (${a.date})`).join('\n'));
} else {
  console.error('Uso: node scripts/sync-fotopix.mjs linktree|nicolabragafoto');
  process.exit(2);
}
