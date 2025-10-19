# Research - KNUE Policy Link Collection

**Task ID**: `init-policy-parser`
**Date**: 2025-10-19
**Status**: Completed

## Context

User requested to create a new project to collect `previewUrl` links from a specific KNUE policy page, separate from the existing RSS parser project.

## Target Analysis

### Policy Page
- **URL**: `https://www.knue.ac.kr/www/contents.do?key=392`
- **Purpose**: University regulations and policy documents page
- **Content Type**: HTML page with embedded file links

### Link Pattern Discovery

Through page analysis (via curl), identified consistent URL patterns:

#### Preview Links
```
./previewMenuCntFile.do?key=392&fileNo=868
./previewMenuCntFile.do?key=392&fileNo=1345
./previewMenuCntFile.do?key=392&fileNo=1459
```

#### Download Links
```
/downloadContentsFile.do?key=392&fileNo=868
/downloadContentsFile.do?key=392&fileNo=1345
/downloadContentsFile.do?key=392&fileNo=1459
```

### Pattern Structure

Each policy document has:
- **Unique identifier**: `fileNo` (e.g., 868, 1345, 1459)
- **Page context**: `key` (always 392 for this page)
- **Dual access**: Preview and download endpoints
- **Associated title**: Text label preceding the links (e.g., "한국교원대학교 설치령")

### Extraction Strategy

**Regular Expression Approach**:
- Pattern: `previewMenuCntFile\.do\?key=(\d+)&fileNo=(\d+)`
- Captures both `key` and `fileNo` parameters
- Deduplication required (links appear multiple times in HTML)

**Title Extraction**:
- Pattern: `<p class="text_left">([^<]+)</p>` followed by `fileNo={fileNo}` within 500 chars
- Provides human-readable document names

### Data Volume

Initial analysis shows:
- **96 unique policy documents** on the page
- Each with preview + download URL pair
- Majority have associated titles

## Comparison with Existing Projects

### knue-www-rss-parser-cf
- **Purpose**: Parse RSS feeds from multiple boards
- **Frequency**: Daily (cron)
- **Output**: Markdown files per article
- **Trigger**: Scheduled

### knue-www-preview-parser-cf
- **Purpose**: Parse attachment previews
- **Trigger**: On-demand (API)
- **Output**: JSON response

### New Project (knue-www-policy-parser-cf)
- **Purpose**: Collect policy document links
- **Frequency**: Weekly (regulations change infrequently)
- **Output**: JSON file with link inventory
- **Trigger**: Scheduled

## Architecture Decision

**Rationale for Separate Project**:
1. Different domain (policies vs. board posts)
2. Different frequency (weekly vs. daily)
3. Different output format (link collection vs. content conversion)
4. Single Responsibility Principle
5. Consistent with existing pattern (preview-parser is also separate)

## Infrastructure Reuse

From `knue-www-rss-parser-cf`:
- `.agents/` policy structure
- TypeScript/ESLint/Vitest configuration
- R2 storage utilities (adapted)
- Test infrastructure patterns
- Husky pre-commit hooks
- Same R2 bucket (`knue-vectorstore`)

## Evidence

- Page HTML captured to `fixtures/policy-page-sample.html` (3228 lines)
- Verified 96 unique fileNo values extracted
- Confirmed title extraction for majority of documents
