import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALL_INDEXABLE_PAGES,
  buildNextMetadata,
  buildPrivateProjectMetadata,
  generateStructuredDataForPage,
  getPageSeoConfig,
  SEO_AUDIT_CHECKLIST,
  SEO_CATEGORY_DIRECTORY,
  SEO_PAGES,
  SITE_NAME,
  SITE_URL,
  TOOL_LANDING_PAGES,
} from '@/lib/seo/registry';
import {
  evaluateWebVitalRating,
  getDefaultWebVitalsSnapshot,
} from '@/lib/seo/web-vitals';
import sitemap from '@/app/sitemap';
import robots from '@/app/robots';

const REQUIRED_PATHS = [
  '/',
  '/online-video-editor',
  '/video-trimmer',
  '/video-cropper',
  '/video-resizer',
  '/video-rotator',
  '/video-merger',
  '/video-to-audio-converter',
  '/add-text-to-video',
  '/video-speed-changer',
  '/help',
  '/privacy-policy',
  '/terms-of-service',
];

describe('Technical SEO & Next.js Architecture Suite', () => {
  it('1. defines all 13 required pages with descriptive, stable URLs and corresponding Next.js route files', () => {
    expect(ALL_INDEXABLE_PAGES.length).toBe(13);

    for (const routePath of REQUIRED_PATHS) {
      expect(SEO_PAGES[routePath]).toBeDefined();
      const pageConfig = getPageSeoConfig(routePath);
      expect(pageConfig.path).toBe(routePath);

      // Verify stable lowercase kebab-case URL format
      expect(routePath).toMatch(/^\/([a-z0-9-]+)?$/);

      // Verify physical route file exists in /app
      const appFilePath =
        routePath === '/'
          ? path.join(process.cwd(), 'app', 'page.tsx')
          : path.join(process.cwd(), 'app', routePath.slice(1), 'page.tsx');
      expect(fs.existsSync(appFilePath)).toBe(true);
    }

    // Verify 404, error, and private project routes also exist
    expect(fs.existsSync(path.join(process.cwd(), 'app', 'not-found.tsx'))).toBe(
      true
    );
    expect(fs.existsSync(path.join(process.cwd(), 'app', 'error.tsx'))).toBe(
      true
    );
    expect(
      fs.existsSync(
        path.join(process.cwd(), 'app', 'projects', '[projectId]', 'page.tsx')
      )
    ).toBe(true);
  });

  it('2. assigns a unique title (30–60 chars) and unique meta description (120–160 chars) to every indexable page', () => {
    const titles = new Set<string>();
    const descriptions = new Set<string>();
    const h1Headings = new Set<string>();

    for (const page of ALL_INDEXABLE_PAGES) {
      expect(page.title.length).toBeGreaterThanOrEqual(30);
      expect(page.title.length).toBeLessThanOrEqual(60);

      expect(page.description.length).toBeGreaterThanOrEqual(120);
      expect(page.description.length).toBeLessThanOrEqual(160);

      expect(titles.has(page.title)).toBe(false);
      expect(descriptions.has(page.description)).toBe(false);
      expect(h1Headings.has(page.h1)).toBe(false);

      titles.add(page.title);
      descriptions.add(page.description);
      h1Headings.add(page.h1);
    }

    expect(titles.size).toBe(13);
    expect(descriptions.size).toBe(13);
    expect(h1Headings.size).toBe(13);
  });

  it('3. configures canonical URLs, Open Graph, and Twitter Card metadata via the Next.js Metadata API', () => {
    for (const page of ALL_INDEXABLE_PAGES) {
      const meta = buildNextMetadata(page.path);
      const expectedFullUrl =
        page.path === '/' ? SITE_URL : `${SITE_URL}${page.path}`;

      expect(meta.title).toBe(page.title);
      expect(meta.description).toBe(page.description);
      expect(meta.alternates?.canonical).toBe(page.path);

      // Open Graph verification
      expect(meta.openGraph).toBeDefined();
      const og = meta.openGraph as Record<string, unknown>;
      expect(og.title).toBe(page.title);
      expect(og.description).toBe(page.description);
      expect(og.url).toBe(expectedFullUrl);
      expect(og.siteName).toBe(SITE_NAME);
      expect(og.type).toBe('website');

      // Twitter Card verification
      expect(meta.twitter).toBeDefined();
      const tw = meta.twitter as Record<string, unknown>;
      expect(tw.card).toBe('summary_large_image');
      expect(tw.title).toBe(page.title);
      expect(tw.description).toBe(page.description);

      // Indexable robots configuration
      const robotsMeta = meta.robots as Record<string, unknown>;
      expect(robotsMeta.index).toBe(true);
      expect(robotsMeta.follow).toBe(true);
    }
  });

  it('4. generates sitemap.xml with all 13 public routes and excludes private project routes', () => {
    const entries = sitemap();
    expect(entries.length).toBe(13);

    const urls = entries.map((e) => e.url);
    for (const routePath of REQUIRED_PATHS) {
      const expectedUrl =
        routePath === '/' ? SITE_URL : `${SITE_URL}${routePath}`;
      expect(urls).toContain(expectedUrl);
    }

    // Private project URLs must never appear in sitemap.xml
    expect(urls.some((u) => u.includes('/projects/'))).toBe(false);
  });

  it('5. generates robots.txt allowing public pages, disallowing /projects/ and /api/, and referencing sitemap.xml', () => {
    const robotsConfig = robots();
    expect(robotsConfig.sitemap).toBe(`${SITE_URL}/sitemap.xml`);

    const rules = Array.isArray(robotsConfig.rules)
      ? robotsConfig.rules[0]
      : robotsConfig.rules;
    expect(rules.userAgent).toBe('*');
    expect(rules.allow).toBe('/');
    expect(rules.disallow).toContain('/projects/');
    expect(rules.disallow).toContain('/api/');
  });

  it('6. enforces strict noindex, nofollow directives on private project routes', () => {
    const privateMeta = buildPrivateProjectMetadata('proj-local-98765');
    expect(privateMeta.title).toContain('Private Project');
    const robotsObj = privateMeta.robots as {
      index?: boolean;
      follow?: boolean;
      nocache?: boolean;
      googleBot?: { index?: boolean; follow?: boolean };
    };
    expect(robotsObj.index).toBe(false);
    expect(robotsObj.follow).toBe(false);
    expect(robotsObj.nocache).toBe(true);
    expect(robotsObj.googleBot?.index).toBe(false);
    expect(robotsObj.googleBot?.follow).toBe(false);
  });

  it('7. implements Schema.org JSON-LD structured data ONLY when eligible', () => {
    // Tool pages are eligible for WebApplication, HowTo, FAQPage, and BreadcrumbList
    for (const toolPage of TOOL_LANDING_PAGES) {
      const schemas = generateStructuredDataForPage(toolPage.path);
      const types = schemas.map((s) => s['@type']);
      expect(types).toContain('WebApplication');
      expect(types).toContain('HowTo');
      expect(types).toContain('FAQPage');
      expect(types).toContain('BreadcrumbList');
    }

    // Homepage has WebApplication and FAQPage, no BreadcrumbList
    const homeSchemas = generateStructuredDataForPage('/');
    const homeTypes = homeSchemas.map((s) => s['@type']);
    expect(homeTypes).toContain('WebApplication');
    expect(homeTypes).toContain('FAQPage');
    expect(homeTypes).not.toContain('BreadcrumbList');

    // Help page has FAQPage and BreadcrumbList, not WebApplication or HowTo
    const helpSchemas = generateStructuredDataForPage('/help');
    const helpTypes = helpSchemas.map((s) => s['@type']);
    expect(helpTypes).toContain('FAQPage');
    expect(helpTypes).toContain('BreadcrumbList');
    expect(helpTypes).not.toContain('WebApplication');
    expect(helpTypes).not.toContain('HowTo');

    // Legal pages (/privacy-policy and /terms-of-service) must NOT output WebApplication, HowTo, or FAQPage
    for (const legalPath of ['/privacy-policy', '/terms-of-service']) {
      const legalSchemas = generateStructuredDataForPage(legalPath);
      const legalTypes = legalSchemas.map((s) => s['@type']);
      expect(legalTypes).toEqual(['BreadcrumbList']);
      expect(legalTypes).not.toContain('WebApplication');
      expect(legalTypes).not.toContain('HowTo');
      expect(legalTypes).not.toContain('FAQPage');
    }
  });

  it('8. maintains a valid internal link graph between related tools and avoids thin or duplicate content', () => {
    const overviewParagraphs = new Set<string>();

    for (const page of ALL_INDEXABLE_PAGES) {
      // Every page must have at least 2 detailed operationOverview paragraphs
      expect(page.operationOverview.length).toBeGreaterThanOrEqual(2);
      for (const para of page.operationOverview) {
        expect(para.length).toBeGreaterThan(80);
        // Ensure paragraphs are not duplicated across pages
        expect(overviewParagraphs.has(para)).toBe(false);
        overviewParagraphs.add(para);
      }

      // Every page must link to at least 3 valid related internal routes and never link to itself
      expect(page.relatedTools.length).toBeGreaterThanOrEqual(3);
      for (const rel of page.relatedTools) {
        expect(rel.path).not.toBe(page.path);
        expect(SEO_PAGES[rel.path]).toBeDefined();
        expect(rel.label.length).toBeGreaterThan(3);
        expect(rel.relationship.length).toBeGreaterThan(10);
      }
    }
  });

  it('9. evaluates Core Web Vitals thresholds accurately and provides the 15-point SEO audit checklist', () => {
    expect(evaluateWebVitalRating('LCP', 1200)).toBe('good');
    expect(evaluateWebVitalRating('LCP', 3100)).toBe('needs-improvement');
    expect(evaluateWebVitalRating('LCP', 4500)).toBe('poor');

    expect(evaluateWebVitalRating('CLS', 0.0)).toBe('good');
    expect(evaluateWebVitalRating('CLS', 0.18)).toBe('needs-improvement');
    expect(evaluateWebVitalRating('CLS', 0.35)).toBe('poor');

    expect(evaluateWebVitalRating('INP', 40)).toBe('good');
    expect(evaluateWebVitalRating('INP', 280)).toBe('needs-improvement');
    expect(evaluateWebVitalRating('INP', 600)).toBe('poor');

    const snapshot = getDefaultWebVitalsSnapshot();
    expect(snapshot.LCP.rating).toBe('good');
    expect(snapshot.CLS.value).toBe(0);
    expect(snapshot.CLS.rating).toBe('good');

    expect(SEO_AUDIT_CHECKLIST.length).toBe(15);
    expect(SEO_AUDIT_CHECKLIST.every((item) => item.status === 'verified')).toBe(
      true
    );
  });

  it('10. organizes all 13 pages into SEO_CATEGORY_DIRECTORY and renders Homepage & All Categories above the workspace on /', () => {
    expect(SEO_CATEGORY_DIRECTORY.length).toBe(5);
    const categorizedPaths = SEO_CATEGORY_DIRECTORY.flatMap((group) =>
      group.pages.map((p) => p.path)
    );
    expect(categorizedPaths.length).toBe(13);
    for (const requiredPath of REQUIRED_PATHS) {
      expect(categorizedPaths).toContain(requiredPath);
    }

    const homePageSource = fs.readFileSync(
      path.join(process.cwd(), 'app', 'page.tsx'),
      'utf8'
    );
    const headerIndex = homePageSource.indexOf('<SiteHeader');
    const categoriesIndex = homePageSource.indexOf('id="all-categories"');
    const workspaceIndex = homePageSource.indexOf('<LazyWorkspaceLoader');

    expect(headerIndex).toBeGreaterThan(-1);
    expect(categoriesIndex).toBeGreaterThan(headerIndex);
    expect(workspaceIndex).toBeGreaterThan(categoriesIndex);
  });
});

