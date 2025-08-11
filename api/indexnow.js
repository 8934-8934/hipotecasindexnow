import { parseStringPromise } from 'xml2js';

const INDEXNOW_ENDPOINT = 'https://api/indexnow.org/indexnow'.replace('/indexnow', '/indexnow'); // placeholder harmless

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).send('Method not allowed');

    const SITE_HOST = process.env.SITE_HOST;
    const SITEMAP_URL = process.env.SITEMAP_URL;
    const INDEXNOW_KEY = process.env.INDEXNOW_KEY;
    const INDEXNOW_KEY_LOCATION = process.env.INDEXNOW_KEY_LOCATION;
    if (!SITE_HOST || !SITEMAP_URL || !INDEXNOW_KEY || !INDEXNOW_KEY_LOCATION) {
      return res.status(400).json({ ok: false, error: 'Missing env vars' });
    }

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 20000);
    const xml = await (await fetch(SITEMAP_URL, { signal: controller.signal })).text();
    clearTimeout(t);

    const parsed = await parseStringPromise(xml);
    let urls = [];
    if (parsed?.urlset?.url) {
      urls = parsed.urlset.url.map(u => u.loc?.[0]).filter(Boolean);
    } else if (parsed?.sitemapindex?.sitemap) {
      const locs = parsed.sitemapindex.sitemap.map(s => s.loc?.[0]).filter(Boolean);
      const results = await Promise.allSettled(
        locs.map(async loc => {
          const txt = await (await fetch(loc)).text();
          return parseStringPromise(txt);
        })
      );
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value?.urlset?.url) {
          urls.push(...r.value.urlset.url.map(u => u.loc?.[0]).filter(Boolean));
        }
      }
    }
    urls = Array.from(new Set(urls)).slice(0, 10000);
    if (urls.length === 0) return res.status(200).json({ ok: true, message: 'Sitemap vacío o no reconocido' });

    const payload = { host: SITE_HOST, key: INDEXNOW_KEY, keyLocation: INDEXNOW_KEY_LOCATION, urlList: urls };
    const r = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload)
    });
    const text = await r.text();

    return res.status(200).json({ ok: r.status === 200, indexnow_status: r.status, submitted: urls.length, response: text.slice(0, 2000) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'Unexpected error' });
  }
}
