#!/usr/bin/env python3
"""
update_links.py
Busca álbuns de https://fotopix.com.br/ e atualiza links-data.js
Execute: python3 update_links.py
"""

import urllib.request
import re
import json
import os
import datetime
import time

FOTOGRAFO_ID = 292380
OUTPUT_FILE = os.path.join(os.path.dirname(__file__), "links-data.js")
MONTHS_TO_FETCH = 6  # busca os últimos N meses

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
}


def fetch(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=20) as response:
        return response.read().decode("utf-8")


def get_album_ids_for_month(year, month):
    """Retorna lista de IDs decimais dos álbuns de um mês."""
    url = (
        f"https://fotopix.com.br/whitelabel/albuns_recentes.php"
        f"?id_fotografo={FOTOGRAFO_ID}&ano={year}&mes={month:02d}"
    )
    html = fetch(url)
    ids = re.findall(r'onclick="tela_album_white_label\((\d+)\)"', html)
    return list(dict.fromkeys(int(i) for i in ids))  # deduplica, preserva ordem


def get_album_title(album_id):
    """Busca a página do álbum e extrai o título completo do H1."""
    hex_id = hex(album_id)[2:]
    url = f"https://fotopix.com.br/album/{hex_id}"
    html = fetch(url)

    # H1 com o título completo
    m = re.search(r'<h1[^>]*>\s*([^<]+?)\s*</h1>', html, re.IGNORECASE)
    if m:
        title = m.group(1).strip()
        return title, url

    # Fallback: título da página antes de " - Álbum"
    m = re.search(r'<title>\s*([^<|]+?)\s*(?:-\s*Álbum|\|)', html, re.IGNORECASE)
    if m:
        return m.group(1).strip(), url

    return None, url


def main():
    now = datetime.datetime.now()
    links = []
    seen_ids = set()

    for i in range(MONTHS_TO_FETCH):
        month = now.month - i
        year = now.year
        while month <= 0:
            month += 12
            year -= 1

        print(f"Buscando {year}/{month:02d}...", end=" ", flush=True)
        try:
            ids = get_album_ids_for_month(year, month)
            print(f"{len(ids)} álbuns")
            for album_id in ids:
                if album_id in seen_ids:
                    continue
                seen_ids.add(album_id)
                hex_id = hex(album_id)[2:]
                href = f"https://fotopix.com.br/album/{hex_id}"
                try:
                    title, _ = get_album_title(album_id)
                    if title:
                        links.append({"href": href, "text": title})
                        print(f"  ✓ {title}")
                    else:
                        print(f"  ⚠ sem título: {href}")
                    time.sleep(0.2)  # respeita o servidor
                except Exception as e:
                    print(f"  ✗ album {hex_id}: {e}")
        except Exception as e:
            print(f"erro: {e}")

    if not links:
        print("\nNenhum link encontrado.")
        return

    updated_at = now.strftime("%d/%m/%Y %H:%M")
    content = (
        "// Gerado automaticamente por update_links.py\n"
        "// Fonte: https://fotopix.com.br/\n"
        f"// Atualizado em: {updated_at}\n"
        "window.LINKS_DATA = "
        + json.dumps({"updated_at": updated_at, "links": links}, ensure_ascii=False, indent=2)
        + ";\n"
    )
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write(content)

    print(f"\n✓ {len(links)} links salvos em links-data.js")


if __name__ == "__main__":
    main()
