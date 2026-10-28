// Sincroniza os álbuns recentes do fotopix.com.br (fotógrafo 292380) com este repositório.
// Uso: node scripts/sync-fotopix.mjs linktree          -> atualiza links-data.js + index.html (repo nicolabraga/linktree)
//      node scripts/sync-fotopix.mjs nicolabragafoto   -> atualiza data/albums.json (repo nicolabraga/linktree-nicolabragafoto)
//      node scripts/sync-fotopix.mjs fotopix           -> atualiza links-data.js (repo nicolabraga/linktree-fotopix)
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

async function get(url, headers = HEADERS) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers });
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

// Listagem: o fotopix (plataforma Banlek) desativou whitelabel/albuns_recentes.php em 27/10/2026.
// Agora os álbuns vêm da API GraphQL da Banlek (persisted query GetAlbumByUserQuery, sem login).
const GQL_URL = 'https://graphql.banlek.com/graphql';
const GQL_HASH = '0890b8c122390fb39be001b264c39c3f1704c89fb0dad971439bacc7024ac4e6';
const API_TITLES = new Map(); // href -> título vindo da API

async function listHrefs(months = 2) {
  const pages = months > 2 ? 3 : 2; // 32 álbuns por página (~1 mês de treinos)
  const hrefs = [];
  for (let page = 1; page <= pages; page++) {
    const qs = new URLSearchParams({
      operationName: 'GetAlbumByUserQuery',
      variables: JSON.stringify({ id_fotografo: ID_FOTO, periodo: 'passados', nav: { page, itemsPerPage: 32 } }),
      extensions: JSON.stringify({ persistedQuery: { version: 1, sha256Hash: GQL_HASH } }),
    });
    const r = await get(`${GQL_URL}?${qs}`, {
      ...HEADERS, 'content-type': 'application/json', 'accept-language': 'pt',
      Origin: 'https://fotopix.com.br', Referer: 'https://fotopix.com.br/',
    });
    const j = await r.json();
    if (j.errors?.length) throw new Error('API Banlek: ' + j.errors.map(e => e.message).join('; '));
    const items = j.data?.albuns?.items || [];
    for (const a of items) {
      const href = `https://fotopix.com.br/album/${Number(a.id).toString(16)}`;
      hrefs.push(href);
      if (a.titulo) API_TITLES.set(href, decodeEntities(String(a.titulo)).replace(/\s+/g, ' ').trim());
    }
    if (items.length < 32) break;
  }
  if (!hrefs.length) throw new Error('Nenhum álbum encontrado na API da Banlek (consulta mudou ou bloqueou o acesso?)');
  return [...new Set(hrefs)];
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
  for (const href of hrefs) out.push({ href, text: API_TITLES.get(href) || await fetchTitle(href) });
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
} else if (MODE === 'fotopix') {
  // Repo nicolabraga/linktree-fotopix: varre 6 meses.
  // Título = <title> sem o sufixo " | Fortaleza, CE" (só corta no "|" com espaços,
  // porque o próprio nome pode ter "|", ex.: "Tarde|Noite"). Fallback <h1>.
  // Padrão final: "Nome - Fortaleza - DD/MM/AAAA" (tudo depois da data sai, ex.: " - Álbum de Fotos de Corrida").
  const tidy = t => {
    t = t.replace(/\s-(\d{2}\/)/, ' - $1').trim();
    const cut = t.match(/^(.*?\d{2}\/{1,2}\d{2}\/\d{4})/);
    return cut ? cut[1] : t;
  };
  const fotopixTitle = async href => {
    const r = await get(href);
    const buf = await r.arrayBuffer();
    const cs = (r.headers.get('content-type') || '').match(/charset=([^\s;]+)/i)?.[1] || 'utf-8';
    let html;
    try { html = new TextDecoder(cs).decode(buf); } catch { html = new TextDecoder('utf-8').decode(buf); }
    const title = tidy(decodeEntities(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ')
      .split(/\s+\|\s+/)[0]);
    const h1 = decodeEntities(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '').replace(/<[^>]+>/g, '').trim();
    return title || h1 || href;
  };
  const existing = parseLinks(fs.readFileSync('links-data.js', 'utf8'));
  const known = new Set(existing.map(l => l.href));
  const hrefs = (await listHrefs(6)).filter(h => !known.has(h));
  const fresh = [];
  for (const href of hrefs) {
    const apiT = API_TITLES.get(href) && tidy(API_TITLES.get(href));
    if (apiT) { fresh.push({ href, text: apiT }); continue; }
    try { fresh.push({ href, text: await fotopixTitle(href) }); } catch { fresh.push({ href, text: href }); }
  }
  // Conserta títulos antigos quebrados (sem data, só o link, ou com &amp;).
  let repaired = 0;
  for (const l of existing) {
    const t = tidy(l.text);
    if (t !== l.text) { l.text = t; repaired++; }
  }
  for (const l of existing) {
    if (/\d{2}\/{1,2}\d{2}\/\d{4}/.test(l.text) && l.text !== l.href && !/&(amp|quot|#\d+);/.test(l.text)) continue;
    try {
      const t = await fotopixTitle(l.href);
      if (t !== l.href && t !== l.text) { console.log(`Corrigido: ${l.text} -> ${t}`); l.text = t; repaired++; }
    } catch {}
  }
  if (!fresh.length && !repaired) { console.log('Nenhum álbum novo.'); process.exit(0); }
  const all = [...fresh, ...existing];
  fs.writeFileSync('links-data.js', `// Gerado automaticamente por update_links.py\n// Fonte: https://fotopix.com.br/\n// Atualizado em: ${TS}\nwindow.LINKS_DATA = {\n  "updated_at": "${TS}",\n  "links": ${JSON.stringify(all, null, 4)}\n};`);
  console.log(`Álbuns novos (+${fresh.length}), títulos corrigidos: ${repaired}\n` + fresh.map(l => '- ' + l.text).join('\n'));
} else {
  console.error('Uso: node scripts/sync-fotopix.mjs linktree|nicolabragafoto|fotopix');
  process.exit(2);
}
