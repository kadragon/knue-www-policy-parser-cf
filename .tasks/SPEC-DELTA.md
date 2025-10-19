# Specification - Policy Link Collection Worker

**Task ID**: `init-policy-parser`
**Version**: 1.0.0
**Date**: 2025-10-19

## Acceptance Criteria

### AC-1: Scheduled Execution
- **GIVEN** the worker is deployed with cron trigger `0 2 * * 0`
- **WHEN** the scheduled time arrives (every Sunday at 2AM UTC / 11AM KST)
- **THEN** the worker executes the link collection workflow

### AC-2: Page Fetching
- **GIVEN** the policy page URL is configured
- **WHEN** the worker fetches the page
- **THEN** it retrieves the full HTML content
- **AND** retries up to 3 times on transient failures
- **AND** uses exponential backoff (1s, 2s, 4s)
- **AND** times out after 5 seconds per attempt

### AC-3: Link Extraction
- **GIVEN** HTML content from the policy page
- **WHEN** the worker parses the content
- **THEN** it extracts all unique `fileNo` values
- **AND** generates preview URLs: `https://www.knue.ac.kr/www/previewMenuCntFile.do?key={key}&fileNo={fileNo}`
- **AND** generates download URLs: `https://www.knue.ac.kr/downloadContentsFile.do?key={key}&fileNo={fileNo}`
- **AND** removes duplicate entries

### AC-4: Title Enrichment
- **GIVEN** extracted links with fileNo values
- **WHEN** the worker enriches the data
- **THEN** it attempts to extract document titles from the HTML
- **AND** includes title when found
- **AND** gracefully omits title when not found

### AC-5: R2 Storage
- **GIVEN** enriched link data
- **WHEN** the worker saves to R2
- **THEN** it creates a JSON file at path `policy/{pageKey}/YYYY_MM_DD_links.json`
- **AND** the JSON contains: timestamp, pageKey, count, and links array
- **AND** each link contains: fileNo, previewUrl, downloadUrl, optional title
- **AND** content-type is set to `application/json`

### AC-6: Duplicate Prevention
- **GIVEN** a file already exists for today's date
- **WHEN** the worker runs again
- **THEN** it skips saving
- **AND** logs a skip message
- **AND** does not throw an error

### AC-7: HTTP Request Rejection
- **GIVEN** a direct HTTP request to the worker
- **WHEN** the request is received
- **THEN** it returns 405 Method Not Allowed
- **AND** includes error message explaining cron-only operation

### AC-8: Error Handling
- **GIVEN** any step fails (fetch, parse, save)
- **WHEN** the error occurs
- **THEN** the worker logs detailed error information
- **AND** throws the error to fail the cron execution
- **AND** does not save partial/corrupted data

## Data Schema

### Link Object
```typescript
interface PolicyLink {
  fileNo: string;        // Unique identifier (e.g., "868")
  previewUrl: string;    // Full preview URL
  downloadUrl: string;   // Full download URL
  title?: string;        // Optional document title
}
```

### R2 File Content
```typescript
{
  timestamp: string;     // ISO-8601 format
  pageKey: string;       // Page identifier (e.g., "392")
  count: number;         // Number of links
  links: PolicyLink[];   // Array of links
}
```

## Non-Functional Requirements

### Performance
- Total execution time < 10 seconds under normal conditions
- Timeout per fetch attempt: 5 seconds
- Maximum retries: 3

### Reliability
- Retry on: HTTP 429, 503, timeout, network errors
- No retry on: HTTP 404, 400, parse errors
- Idempotent: safe to run multiple times per day

### Observability
- Structured logging at each stage
- Success/failure statistics
- Execution duration tracking
- Error details (message, stack trace)

### Storage
- File path format: `policy/{pageKey}/YYYY_MM_DD_links.json`
- Bucket: `knue-vectorstore` (shared with RSS parser)
- Retention: Indefinite (manual cleanup if needed)

## Environment Variables

| Variable | Required | Example | Description |
|----------|----------|---------|-------------|
| `POLICY_PAGE_URL` | Yes | `https://www.knue.ac.kr/www/contents.do?key=392` | Full URL of policy page |
| `POLICY_PAGE_KEY` | Yes | `392` | Page key for URL filtering |
| `POLICY_STORAGE` | Yes | R2Bucket binding | R2 bucket for storage |

## Test Requirements

### Unit Tests
- [x] Link parsing from HTML
- [x] Preview URL generation
- [x] Download URL generation
- [x] Duplicate removal
- [x] Title extraction
- [x] R2 write with correct structure
- [x] R2 skip on existing file
- [x] Date-based path generation

### Integration Tests
- [x] Full workflow (fetch → parse → enrich → save)
- [x] HTTP request rejection
- [x] Duplicate execution skip
- [x] Fetch error handling
- [x] Title enrichment in workflow

### Coverage Target
- Minimum: 80%
- Current: 100% (20/20 tests passing)

## Out of Scope

- Document content download (future enhancement)
- Document content parsing/vectorization (separate project)
- Historical change tracking (single snapshot per day)
- Multi-page support (only key=392)
- Authentication/authorization (public page)
