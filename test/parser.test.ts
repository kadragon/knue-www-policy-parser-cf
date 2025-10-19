import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parsePolicyLinks, enrichLinksWithTitles, extractTitle } from '../src/page/parser';

const fixtureHTML = readFileSync(
  join(__dirname, '../fixtures/policy-page-sample.html'),
  'utf-8'
);

describe('parsePolicyLinks', () => {
  it('should extract policy links from HTML', () => {
    const links = parsePolicyLinks(fixtureHTML, '392');

    expect(links.length).toBeGreaterThan(0);
    expect(links.every(link => link.fileNo)).toBe(true);
    expect(links.every(link => link.previewUrl)).toBe(true);
    expect(links.every(link => link.downloadUrl)).toBe(true);
  });

  it('should create correct preview URLs', () => {
    const links = parsePolicyLinks(fixtureHTML, '392');
    const firstLink = links[0];

    expect(firstLink.previewUrl).toMatch(
      /^https:\/\/www\.knue\.ac\.kr\/www\/previewMenuCntFile\.do\?key=392&fileNo=\d+$/
    );
  });

  it('should create correct download URLs', () => {
    const links = parsePolicyLinks(fixtureHTML, '392');
    const firstLink = links[0];

    expect(firstLink.downloadUrl).toMatch(
      /^https:\/\/www\.knue\.ac\.kr\/downloadContentsFile\.do\?key=392&fileNo=\d+$/
    );
  });

  it('should not have duplicate fileNo entries', () => {
    const links = parsePolicyLinks(fixtureHTML, '392');
    const fileNos = links.map(link => link.fileNo);
    const uniqueFileNos = new Set(fileNos);

    expect(fileNos.length).toBe(uniqueFileNos.size);
  });

  it('should filter by page key', () => {
    const links = parsePolicyLinks(fixtureHTML, '999');
    expect(links.length).toBe(0);
  });
});

describe('extractTitle', () => {
  it('should extract title for a known fileNo', () => {
    const title = extractTitle(fixtureHTML, '868');
    expect(title).toBeDefined();
    expect(title).toContain('설치령');
  });

  it('should return undefined for unknown fileNo', () => {
    const title = extractTitle(fixtureHTML, '999999');
    expect(title).toBeUndefined();
  });
});

describe('enrichLinksWithTitles', () => {
  it('should add titles to links', () => {
    const links = parsePolicyLinks(fixtureHTML, '392');
    const enrichedLinks = enrichLinksWithTitles(fixtureHTML, links);

    const withTitles = enrichedLinks.filter(link => link.title);
    expect(withTitles.length).toBeGreaterThan(0);
  });

  it('should preserve original link data', () => {
    const links = parsePolicyLinks(fixtureHTML, '392');
    const enrichedLinks = enrichLinksWithTitles(fixtureHTML, links);

    expect(enrichedLinks.length).toBe(links.length);
    enrichedLinks.forEach((enriched, index) => {
      expect(enriched.fileNo).toBe(links[index].fileNo);
      expect(enriched.previewUrl).toBe(links[index].previewUrl);
      expect(enriched.downloadUrl).toBe(links[index].downloadUrl);
    });
  });
});
