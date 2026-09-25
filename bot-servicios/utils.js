const MX_TZ = 'America/Mexico_City';

function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactText(value = '') {
  return normalizeText(value).replace(/[^a-z0-9]/g, '');
}

function money(value) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(Number(value) || 0);
}

function formatDate(value) {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: MX_TZ,
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

function normalizePhone(value = '') {
  const digits = String(value).replace(/\D/g, '');
  return digits ? `${digits}@s.whatsapp.net` : '';
}

function isGroupJid(jid = '') {
  return jid.endsWith('@g.us');
}

function getMessageText(msg) {
  const m = msg?.message;
  if (!m) return '';
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentWithCaptionMessage?.message?.documentMessage?.caption ||
    ''
  ).trim();
}

function getQuotedMessageId(msg) {
  return msg?.message?.extendedTextMessage?.contextInfo?.stanzaId ||
    msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage?.key?.id ||
    null;
}

function getQuotedText(msg) {
  return msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage?.conversation ||
    msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage?.extendedTextMessage?.text ||
    msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage?.caption ||
    msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage?.videoMessage?.caption ||
    '';
}

function getSenderJid(msg, ownerJid = '') {
  if (msg?.key?.fromMe) return ownerJid;
  return msg?.key?.participant || msg?.participant || msg?.key?.remoteJid || '';
}

function getMessageTimestamp(msg) {
  const ts = Number(msg?.messageTimestamp || 0);
  return ts ? new Date(ts * 1000) : new Date();
}

function parseMoney(raw) {
  if (raw === undefined || raw === null) return null;
  const cleaned = String(raw)
    .replace(/[\$\s]/g, '')
    .replace(/,/g, '')
    .replace(/^\+/, '');
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? amount : null;
}

function parseServices(text) {
  const source = String(text || '').replace(/\r/g, ' ').trim();
  if (!source) return [];

  const regex = /(?:^|[,;|/\n])\s*\$?\s*([+-]?\d[\d,]*(?:\.\d+)?)\s+([^,;|/\n]+?)(?=\s*(?:[,;|/\n]|\$?[+-]?\d[\d,]*(?:\.\d+)?\s+)|$)/g;
  const results = [];
  let match;

  while ((match = regex.exec(source)) !== null) {
    const amount = parseMoney(match[1]);
    const name = String(match[2] || '')
      .replace(/[.:]+$/g, '')
      .trim();
    if (amount === null || !name) continue;
    results.push({ amount, name });
  }

  if (!results.length) {
    const one = source.match(/^\$?\s*([+-]?\d[\d,]*(?:\.\d+)?)\s+(.+)$/s);
    if (one) {
      const amount = parseMoney(one[1]);
      const name = one[2].trim();
      if (amount !== null && name && !/^\d/.test(name)) results.push({ amount, name });
    }
  }

  return results;
}

function parseNameAndAmount(text) {
  const source = String(text || '').trim();
  if (!source) return null;

  let m = source.match(/^\$?\s*([+-]?\d[\d,]*(?:\.\d+)?)\s*[,:-]?\s+(.+?)$/);
  if (m) {
    const amount = parseMoney(m[1]);
    if (amount !== null) return { amount, name: m[2].trim() };
  }

  m = source.match(/^(.+?)\s*[,:-]?\s+\$?\s*([+-]?\d[\d,]*(?:\.\d+)?)$/);
  if (m) {
    const amount = parseMoney(m[2]);
    if (amount !== null) return { amount, name: m[1].trim() };
  }

  const embedded = source.match(/\$?\s*([+-]?\d[\d,]*(?:\.\d+)?)/);
  if (embedded) {
    const amount = parseMoney(embedded[1]);
    const name = `${source.slice(0, embedded.index)} ${source.slice(embedded.index + embedded[0].length)}`
      .replace(/[,;:-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (amount !== null && name) return { amount, name };
  }

  return { amount: null, name: source };
}

function levenshtein(a, b) {
  const aa = compactText(a);
  const bb = compactText(b);
  if (aa === bb) return 0;
  if (!aa.length) return bb.length;
  if (!bb.length) return aa.length;

  const prev = Array(bb.length + 1);
  const curr = Array(bb.length + 1);
  for (let j = 0; j <= bb.length; j++) prev[j] = j;

  for (let i = 1; i <= aa.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= bb.length; j++) {
      const cost = aa[i - 1] === bb[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= bb.length; j++) prev[j] = curr[j];
  }
  return prev[bb.length];
}

function similarity(a, b) {
  const aa = compactText(a);
  const bb = compactText(b);
  if (!aa || !bb) return 0;
  if (aa === bb) return 1;
  if (aa.includes(bb) || bb.includes(aa)) return 0.9;
  return 1 - (levenshtein(aa, bb) / Math.max(aa.length, bb.length));
}

function chunkText(text, maxLength = 3500) {
  const source = String(text || '');
  if (source.length <= maxLength) return [source];
  const chunks = [];
  let current = '';
  for (const line of source.split('\n')) {
    if ((current + (current ? '\n' : '') + line).length <= maxLength) {
      current += (current ? '\n' : '') + line;
    } else {
      if (current) chunks.push(current);
      if (line.length <= maxLength) current = line;
      else {
        for (let i = 0; i < line.length; i += maxLength) chunks.push(line.slice(i, i + maxLength));
        current = '';
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

module.exports = {
  compactText,
  formatDate,
  getMessageText,
  getMessageTimestamp,
  getQuotedMessageId,
  getQuotedText,
  getSenderJid,
  isGroupJid,
  levenshtein,
  money,
  normalizePhone,
  normalizeText,
  parseMoney,
  parseNameAndAmount,
  parseServices,
  similarity,
  chunkText
};
