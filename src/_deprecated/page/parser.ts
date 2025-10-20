/**
 * DEPRECATED: Page Parser
 *
 * This module is deprecated and will be removed on 2026-01-20.
 * HTML-based policy parsing has been replaced with GitHub markdown parsing.
 *
 * @deprecated Use GitHub markdown parser (src/github/markdown.ts) instead
 * @removal-date 2026-01-20
 */

export interface PolicyLink {
  fileNo: string;
  previewUrl: string;
  downloadUrl: string;
  title?: string;
}

export function parsePolicyLinks(html: string, pageKey: string): PolicyLink[] {
  const links: PolicyLink[] = [];
  const seen = new Set<string>();

  // Match preview links: ./previewMenuCntFile.do?key=392&fileNo=868
  const previewRegex = /previewMenuCntFile\.do\?key=(\d+)&fileNo=(\d+)/g;
  let match;

  while ((match = previewRegex.exec(html)) !== null) {
    const [, key, fileNo] = match;

    if (key !== pageKey) {
      continue; // Skip links from different pages
    }

    if (seen.has(fileNo)) {
      continue; // Skip duplicates
    }

    seen.add(fileNo);

    links.push({
      fileNo,
      previewUrl: `https://www.knue.ac.kr/www/previewMenuCntFile.do?key=${key}&fileNo=${fileNo}`,
      downloadUrl: `https://www.knue.ac.kr/downloadContentsFile.do?key=${key}&fileNo=${fileNo}`
    });
  }

  return links;
}

export function extractTitle(html: string, fileNo: string): string | undefined {
  // Try to find the title for this specific fileNo
  // Pattern: <td><p class="text_left">TITLE</p></td> followed by preview/download links
  const titleRegex = new RegExp(
    `<p class="text_left">([^<]+)</p>[\\s\\S]{0,500}fileNo=${fileNo}`,
    'i'
  );

  const match = html.match(titleRegex);
  return match ? match[1].trim() : undefined;
}

export function enrichLinksWithTitles(html: string, links: PolicyLink[]): PolicyLink[] {
  return links.map(link => ({
    ...link,
    title: extractTitle(html, link.fileNo)
  }));
}
