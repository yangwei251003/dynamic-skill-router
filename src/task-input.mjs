// Keep the original request for traceability; only task text participates in matching.
export function taskText(query = '') {
  const raw = String(query).trim();
  const marker = /^## My request:\s*$/mi.exec(raw);
  const request = marker ? raw.slice(marker.index + marker[0].length) : raw;
  return request
    .replace(/<image\b[^>]*>[\s\S]*?<\/image>/gi, '')
    .replace(/^\s*>.*$/gm, '')
    .replace(/(?:[A-Za-z]:[\\/]|https?:\/\/)[^\s<>"']+/g, (value) => {
      const ext = /\.(pdf|docx|xlsx|csv|pptx|jpg|png|mp4)(?:[?#]|$)/i.exec(value);
      const fileType = ext ? ` .${ext[1]} ` : ' ';
      if (/^https?:/i.test(value)) {
        try { return ` 来源:${new URL(value).hostname} ${fileType}`; } catch { return fileType; }
      }
      return fileType;
    })
    .trim();
}
