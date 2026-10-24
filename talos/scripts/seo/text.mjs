
export const html = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');
export const xml = html;
export const normalize = (value) => String(value ?? '')
  .replace(/\s+/g, ' ')
  .replaceAll('\0', ' ')
  .trim();
export const escapeXmlAttribute = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/"/g, '&quot;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');
