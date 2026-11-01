// Keep the original request for traceability; only task text participates in matching.
export function taskText(query = '', options = {}) {
  const raw = String(query).trim();
  const marker = /^## My request:\s*$/mi.exec(raw);
  const request = marker ? raw.slice(marker.index + marker[0].length) : raw;
  return request
    .replace(/<image\b[^>]*>[\s\S]*?<\/image>/gi, '')
    .replace(/^\s*>.*$/gm, '')
    // A resource token ends at prose punctuation even when Chinese instructions
    // follow without whitespace. Never consume the surrounding authorization.
    .replace(/(?:[A-Za-z]:[\\/]|https?:\/\/)[^\s<>"'“”‘’「」『』：，。；！？、,;!?）)\]】]+/g, (value) => {
      // V4 retains sentence punctuation consumed by a URL token. Otherwise a
      // following action or prohibition is merged into the source clause.
      // Keep the default V3 projection byte-for-byte compatible.
      const boundary=options.preserveNetworkSources&&/^https?:/i.test(value) ? value.match(/\.+$/)?.[0] || '' : '';
      if(boundary)value=value.slice(0,-boundary.length);
      const ext = /\.(pdf|docx|xlsx|csv|pptx|jpg|jpeg|png|webp|svg|mp4|wav|mp3|tex|bib|step|stp|stl|json|yaml|yml|toml|py|js|ts|md|ap17|eprj2)(?:[?#]|$)/i.exec(value);
      const fileType = ext ? ` .${ext[1]} ` : ' ';
      if (/^https?:/i.test(value)) {
        try {
          const hostname=new URL(value).hostname;
          if(!options.preserveNetworkSources)return ` 来源:${hostname} ${fileType}`;
          // Syntactic source kind only: no DNS, connection or availability claim.
          // Retain it inside its clause so quotation/negation/future filters still
          // own scope. A marker has no :/ sequence that can look like a drive path.
          const host=hostname.toLowerCase().replace(/\.$/,'');
          const ip=/^\d+\.\d+\.\d+\.\d+$/.test(host)?host.split('.').map(Number):null;
          const privateHost=!host.includes('.')||host.includes(':')
            || /(?:^|\.)(?:localhost|local|lan|internal|intranet|corp)$/.test(host)
            || ip&&(ip[0]===0||ip[0]===10||ip[0]===127||ip[0]>=224
              ||ip[0]===172&&ip[1]>=16&&ip[1]<=31||ip[0]===192&&ip[1]===168
              ||ip[0]===169&&ip[1]===254||ip[0]===100&&ip[1]>=64&&ip[1]<=127);
          return ` ${privateHost?'本地网络来源':'公网来源'}:${hostname} ${fileType}${boundary}`;
        } catch { return fileType; }
      }
      return fileType;
    })
    .trim();
}
