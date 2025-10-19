import type { PreviewContent } from './fetcher';

export interface PolicyMarkdownData {
  title: string;
  fileNo: string | number;
  previewUrl: string;
  downloadUrl: string;
  savedAt: string;
  lastUpdated: string;
  previewContent?: PreviewContent;
}

/**
 * Format policy data as Markdown
 * Includes basic metadata and fetched preview content
 */
export function formatPolicyAsMarkdown(data: PolicyMarkdownData): string {
  const lines: string[] = [];

  // Front matter
  lines.push('---');
  lines.push(`title: "${escapeYaml(data.title)}"`);
  lines.push(`fileNo: ${data.fileNo}`);
  lines.push(`savedAt: ${data.savedAt}`);
  lines.push(`lastUpdated: ${data.lastUpdated}`);
  lines.push('---');
  lines.push('');

  // Title
  lines.push(`# ${data.title}`);
  lines.push('');

  // Basic Info
  lines.push('## 기본 정보');
  lines.push('');
  lines.push(`- **파일번호**: ${data.fileNo}`);
  lines.push(`- **저장일시**: ${new Date(data.savedAt).toLocaleString('ko-KR')}`);
  lines.push(`- **마지막 수정**: ${new Date(data.lastUpdated).toLocaleString('ko-KR')}`);
  lines.push('');

  // Links
  lines.push('## 링크');
  lines.push('');
  lines.push(`- [미리보기](${data.previewUrl})`);
  lines.push(`- [다운로드](${data.downloadUrl})`);
  lines.push('');

  // Preview Content
  if (data.previewContent) {
    lines.push('## 정책 내용');
    lines.push('');

    if (data.previewContent.summary) {
      lines.push('### 요약');
      lines.push('');
      lines.push(data.previewContent.summary);
      lines.push('');
    }

    if (data.previewContent.content) {
      lines.push('### 전문');
      lines.push('');
      lines.push(data.previewContent.content);
      lines.push('');
    }

    // Additional fields (if any)
    const excludeKeys = ['title', 'content', 'summary'];
    const additionalFields = Object.entries(data.previewContent).filter(
      ([key]) => !excludeKeys.includes(key)
    );

    if (additionalFields.length > 0) {
      lines.push('### 추가 정보');
      lines.push('');
      for (const [key, value] of additionalFields) {
        if (value !== null && value !== undefined) {
          lines.push(`**${key}**: ${String(value)}`);
        }
      }
      lines.push('');
    }
  }

  // Metadata section at the end
  lines.push('---');
  lines.push('');
  lines.push('*이 문서는 자동으로 생성되었습니다.*');

  return lines.join('\n');
}

/**
 * Escape YAML string values
 */
function escapeYaml(value: string): string {
  if (!value) return '""';
  // Escape quotes and backslashes
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
