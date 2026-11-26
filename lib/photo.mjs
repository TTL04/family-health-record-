// US-02 / US-05: photo upload rules. An oversized or unsupported file is
// rejected with a reason; the client shows the reason verbatim.

export const PHOTO_RULES = {
  // US-02 in the A1 backlog: "2 MB JPG uploads in under 3 s with a preview".
  // The limit is therefore 2 MB, not the 10 MB a generic rule set would suggest.
  maxBytes: 2 * 1024 * 1024, // 2 MB
  allowed: {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'application/pdf': 'pdf'
  }
};

export function validatePhoto({ mime, bytes }) {
  const ext = PHOTO_RULES.allowed[mime];
  if (!ext) {
    return { ok: false, reason: '只支持 JPG / PNG / WebP 图片或 PDF 文件' };
  }
  if (bytes > PHOTO_RULES.maxBytes) {
    return { ok: false, reason: `文件超过 ${PHOTO_RULES.maxBytes / 1024 / 1024} MB 限制，请压缩后再上传` };
  }
  if (bytes <= 0) {
    return { ok: false, reason: '文件内容为空' };
  }
  return { ok: true, ext };
}
