export function formatDateISO(date: Date): string {
  return date.toISOString();
}

export function formatDateWithKST(date: Date): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  const parts = formatter.formatToParts(date);
  const values: Record<string, string> = {};

  parts.forEach(({ type, value }) => {
    values[type] = value;
  });

  const { year, month, day, hour, minute, second } = values;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}+09:00`;
}

export function generateR2Key(boardIdx: string, pubDate: string, articleId: string): string {
  const dateOnly = pubDate.split(' ')[0];
  const dateParts = dateOnly.split('-');
  
  if (dateParts.length !== 3) {
    throw new Error(`Invalid date format: ${pubDate}`);
  }
  
  const [year, month, day] = dateParts;
  
  return `rss/${boardIdx}/${year}_${month}_${day}_${articleId}.md`;
}
