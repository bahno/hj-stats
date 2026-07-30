# Track Rank

World and European athlete rankings across all 36 World Athletics track and field
event groups, with Road to Birmingham 2026 qualification tracking.

Live site: https://bahno.info/

## SEO / indexing

To make the site findable via Google search:

- **`public/robots.txt`** — allows all crawlers and points them at the sitemap.
- **`public/sitemap.xml`** — lists the indexable URL(s) so crawlers don't have to discover them by link-following alone.
- **`<link rel="canonical">` and `og:url` in `index.html`** — declare `https://bahno.info/` as the canonical URL, so search engines don't split ranking signals between the custom domain and the `github.io` URL.

These files only make the site *crawlable* — they don't request a crawl. To actually get indexed:

1. Verify the site in [Google Search Console](https://search.google.com/search-console) (custom domain → DNS TXT record verification).
2. Submit `https://bahno.info/sitemap.xml` under Sitemaps.
3. Use URL Inspection → Request Indexing on the homepage to force an initial crawl instead of waiting for Google to find it organically.
