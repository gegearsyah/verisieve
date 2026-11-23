export function isPdfDocumentBuffer(buffer) {
  return Buffer.isBuffer(buffer) && buffer.subarray(0, 1024).indexOf(Buffer.from('%PDF-')) >= 0;
}

export function isHtmlDocumentBuffer(buffer) {
  const prefix = Buffer.from(buffer).subarray(0, 1024).toString('utf8').replace(/^\uFEFF/, '').trimStart();
  return /^(?:<!doctype\s+html\b|<html\b|<head\b|<body\b)/i.test(prefix);
}
