import type { PolicyLink } from '../page/parser';

export interface WriteResult {
  saved: boolean;
  skipped: boolean;
  path?: string;
}

export async function writeLinksToR2(
  bucket: R2Bucket,
  links: PolicyLink[],
  pageKey: string,
  timestamp: Date
): Promise<WriteResult> {
  const year = timestamp.getFullYear();
  const month = String(timestamp.getMonth() + 1).padStart(2, '0');
  const day = String(timestamp.getDate()).padStart(2, '0');

  const path = `policy/${pageKey}/${year}_${month}_${day}_links.json`;

  // Check if file already exists
  const existing = await bucket.head(path);

  if (existing) {
    console.log(`⏭ [R2] File already exists: ${path}`);
    return { saved: false, skipped: true };
  }

  const content = JSON.stringify(
    {
      timestamp: timestamp.toISOString(),
      pageKey,
      count: links.length,
      links
    },
    null,
    2
  );

  await bucket.put(path, content, {
    httpMetadata: {
      contentType: 'application/json'
    }
  });

  console.log(`✓ [R2] Saved ${links.length} links to ${path}`);

  return {
    saved: true,
    skipped: false,
    path
  };
}
