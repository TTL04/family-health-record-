// Zero-dependency HTTP server: static client + JSON API + photo storage.
// Run with: node server.mjs   (no npm install needed)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { Store } from './lib/store.mjs';
import { validatePhoto, PHOTO_RULES } from './lib/photo.mjs';
import { llmConfig, extractReport, explainValue } from './lib/llm.mjs';
import {
  abnormalCount, sortReports, explainText, lookupBuiltin, parseRefText, DISCLAIMER
} from './lib/logic.mjs';
import { normaliseEntry } from './lib/units.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.join(ROOT, 'client');

const CONFIG = {
  port: Number(process.env.PORT) || 3000,
  dataDir: process.env.DATA_DIR || path.join(ROOT, 'data'),
  uploadDir: process.env.UPLOAD_DIR || path.join(ROOT, 'uploads'),
  accessCode: process.env.ACCESS_CODE || ''
};

const store = new Store(CONFIG.dataDir);
const llm = llmConfig();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function badRequest(message) {
  throw Object.assign(new Error(message), { status: 400 });
}

function notFound(message = 'Not found') {
  throw Object.assign(new Error(message), { status: 404 });
}

function serveFile(res, absPath) {
  const type = MIME[path.extname(absPath).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  res.end(fs.readFileSync(absPath));
}

function safeJoin(base, rel) {
  const abs = path.resolve(base, '.' + (rel.startsWith('/') ? rel : '/' + rel));
  if (!abs.startsWith(path.resolve(base) + path.sep)) return null;
  try {
    if (!fs.statSync(abs).isFile()) return null;
  } catch {
    return null;
  }
  return abs;
}

function serveStatic(urlPath, res) {
  if (urlPath === '/' || urlPath === '/index.html') {
    return serveFile(res, path.join(CLIENT, 'index.html'));
  }
  if (urlPath === '/logic.mjs') {
    return serveFile(res, path.join(ROOT, 'lib', 'logic.mjs'));
  }
  // Top-level files (pages and their ./api.mjs style imports) live in client/.
  if (/^\/[^/\\]+$/.test(urlPath)) {
    const file = safeJoin(CLIENT, urlPath.slice(1));
    if (file) return serveFile(res, file);
  }
  if (urlPath.startsWith('/client/')) {
    const file = safeJoin(CLIENT, urlPath.slice('/client/'.length));
    if (file) return serveFile(res, file);
  }
  if (urlPath.startsWith('/uploads/')) {
    const file = safeJoin(CONFIG.uploadDir, urlPath.slice('/uploads/'.length));
    if (file) return serveFile(res, file);
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(Object.assign(new Error(`请求体超过 ${Math.round(limitBytes / 1024 / 1024)} MB 限制`), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req, 16 * 1024 * 1024);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return badRequest('请求体不是合法 JSON');
  }
}

// US-04: a saved item keeps a flag telling whether the human corrected it.
function normalizeItem(raw, index) {
  const name = String(raw?.name || '').trim();
  const value = Number(raw?.value);
  if (!name) badRequest(`第 ${index + 1} 项缺少项目名称`);
  if (!Number.isFinite(value)) badRequest(`「${name}」的数值不是有效数字`);

  let refText = String(raw?.refText || '').trim();
  let refLow = Number.isFinite(Number(raw?.refLow)) ? Number(raw.refLow) : null;
  let refHigh = Number.isFinite(Number(raw?.refHigh)) ? Number(raw.refHigh) : null;
  let unit = String(raw?.unit || '').trim();
  const display = String(raw?.display || '').trim();

  const parsed = parseRefText(refText);
  if (parsed) {
    refLow = refLow ?? parsed.low;
    refHigh = refHigh ?? parsed.high;
  }

  const builtin = lookupBuiltin(name) || (display ? lookupBuiltin(display) : null);
  let boundsFromBuiltin = false;
  if (refLow == null && refHigh == null && builtin) {
    refLow = builtin.low;
    refHigh = builtin.high;
    boundsFromBuiltin = true;
  }
  if (!unit && builtin) unit = builtin.unit;

  // T-01: convert once, here, and nowhere else. Everything stored below is
  // already in the canonical unit, which is what lets isAbnormal keep
  // comparing bare numbers without looking at the unit at all.
  //
  // The bounds travel with the value: a report printing "11.0 - 16.0 g/dL"
  // means that range in g/dL too, so converting only the reading would
  // compare 118 against 16 and call every result high.
  const normalised = normaliseEntry({
    indicator: builtin?.display || display || name,
    value,
    unit,
    refLow,
    refHigh,
    boundsAreCanonical: boundsFromBuiltin
  });
  if (!normalised.ok) {
    const accepted = normalised.accepted?.length ? normalised.accepted.join('、') : '无';
    badRequest(`「${name}」的单位${unit ? `「${unit}」` : ''}无法换算：${normalised.reason}。可接受单位：${accepted}`);
  }

  return {
    id: `i_${crypto.randomUUID().slice(0, 8)}`,
    name,
    display,
    value: normalised.value,
    unit: normalised.unit,
    unitOriginal: normalised.unitOriginal || unit,
    refText,
    refLow: normalised.refLow,
    refHigh: normalised.refHigh,
    corrected: Boolean(raw?.corrected)
  };
}

function normalizeReport(body) {
  const patients = store.data.patients;
  const patientId = String(body?.patientId || patients[0]?.id || '');
  if (!patientId) badRequest('请先创建患者资料');
  if (patients.length && !patients.some(p => p.id === patientId)) badRequest('患者不存在');

  const collectedAt = String(body?.collectedAt || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(collectedAt)) badRequest('采样日期格式应为 YYYY-MM-DD');

  const items = Array.isArray(body?.items) ? body.items.map(normalizeItem) : [];
  if (!items.length) badRequest('至少需要一条检验项目');

  return {
    id: `r_${crypto.randomUUID().slice(0, 8)}`,
    patientId,
    type: String(body?.type || '').trim() || '检验报告',
    hospital: String(body?.hospital || '').trim(),
    collectedAt,
    photo: typeof body?.photo === 'string' && body.photo.startsWith('/uploads/') ? body.photo : null,
    createdAt: new Date().toISOString(),
    items
  };
}

// US-10: previous value of the same indicator, for the trend comparison.
function findPrevItem(report, item) {
  const earlier = sortReports(store.data.reports).filter(r =>
    r.patientId === report.patientId &&
    r.id !== report.id &&
    String(r.collectedAt) < String(report.collectedAt)
  );
  for (const r of earlier) {
    const match = r.items.find(i =>
      i.name === item.name || (item.display && i.display && i.display === item.display)
    );
    if (match) return { value: match.value, unit: match.unit, collectedAt: r.collectedAt };
  }
  return null;
}

function timeline() {
  return sortReports(store.data.reports).map(r => {
    const { items, ...rest } = r;
    return { ...rest, itemCount: items.length, abnormalCount: abnormalCount(items) };
  });
}

function deletePhotoFile(url) {
  if (!url) return;
  const file = safeJoin(CONFIG.uploadDir, url.slice('/uploads/'.length));
  if (file) fs.rmSync(file, { force: true });
}

function parseDataUrl(dataUrl) {
  const m = /^data:([^;]+);base64,([\s\S]+)$/.exec(String(dataUrl || ''));
  if (!m) badRequest('图片必须是 base64 data URL');
  return { mime: m[1].toLowerCase(), buffer: Buffer.from(m[2], 'base64') };
}

async function handleApi(req, res, pathname) {
  // Simple shared gate: one access code protects the whole family space.
  if (CONFIG.accessCode && req.headers['x-access-code'] !== CONFIG.accessCode) {
    return sendJson(res, 401, { error: '需要访问码' });
  }

  if (req.method === 'GET' && pathname === '/api/state') {
    return sendJson(res, 200, {
      extractionEnabled: Boolean(llm),
      patients: store.data.patients,
      reports: timeline(),
      disclaimer: DISCLAIMER
    });
  }

  if (req.method === 'POST' && pathname === '/api/patients') {
    const body = await readJson(req);
    return sendJson(res, 200, store.upsertPatient(body));
  }

  // US-02: photo enters the archive; invalid files are rejected with a reason.
  if (req.method === 'POST' && pathname === '/api/photos') {
    const body = await readJson(req);
    const { mime, buffer } = parseDataUrl(body.data);
    const verdict = validatePhoto({ mime, bytes: buffer.length });
    if (!verdict.ok) badRequest(verdict.reason);
    fs.mkdirSync(CONFIG.uploadDir, { recursive: true });
    const name = `${crypto.randomBytes(10).toString('hex')}.${verdict.ext}`;
    fs.writeFileSync(path.join(CONFIG.uploadDir, name), buffer);
    return sendJson(res, 200, { url: `/uploads/${name}` });
  }

  if (req.method === 'POST' && pathname === '/api/reports') {
    const body = await readJson(req);
    return sendJson(res, 200, store.addReport(normalizeReport(body)));
  }

  const reportMatch = /^\/api\/reports\/([\w-]+)$/.exec(pathname);
  if (reportMatch) {
    const report = store.getReport(reportMatch[1]);
    if (!report) notFound('报告不存在');

    if (req.method === 'GET') return sendJson(res, 200, report);

    // US-11: deleting a report also removes its photo.
    if (req.method === 'DELETE') {
      store.deleteReport(report.id);
      deletePhotoFile(report.photo);
      return sendJson(res, 200, { ok: true });
    }
  }

  // US-03: vision extraction. Degrades to not_configured without a key.
  if (req.method === 'POST' && pathname === '/api/extract') {
    if (!llm) return sendJson(res, 200, { ok: false, reason: 'not_configured' });
    const body = await readJson(req);
    const { mime } = parseDataUrl(body.photo);
    if (!PHOTO_RULES.allowed[mime] || PHOTO_RULES.allowed[mime] === 'pdf') {
      badRequest('自动识别目前只支持图片，PDF 请手动录入');
    }
    const result = await extractReport(llm, body.photo);
    return sendJson(res, 200, result);
  }

  // US-10: plain-language explanation with the trend since last time.
  if (req.method === 'POST' && pathname === '/api/explain') {
    const body = await readJson(req);
    const report = store.getReport(String(body.reportId || ''));
    if (!report) notFound('报告不存在');
    const item = report.items.find(i => i.id === String(body.itemId || ''));
    if (!item) notFound('检验项目不存在');
    const prev = findPrevItem(report, item);
    if (llm) {
      try {
        return sendJson(res, 200, { text: await explainValue(llm, item, prev), source: 'ai' });
      } catch (err) {
        console.error('explain failed, falling back:', err.message);
      }
    }
    return sendJson(res, 200, { text: explainText(item, prev), source: 'builtin' });
  }

  notFound('接口不存在');
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname);
    } else if (req.method === 'GET') {
      serveStatic(pathname, res);
    } else {
      notFound();
    }
  } catch (err) {
    console.error(`${req.method} ${req.url} → ${err.status || 500}: ${err.message}`);
    if (!res.headersSent) {
      sendJson(res, err.status || 500, { error: err.status ? err.message : '服务器内部错误' });
    } else {
      res.end();
    }
  }
});

server.listen(CONFIG.port, () => {
  console.log(`Family Health Record 已启动`);
  console.log(`  本机访问:   http://localhost:${CONFIG.port}`);
  console.log(`  数据目录:   ${CONFIG.dataDir}`);
  console.log(`  照片目录:   ${CONFIG.uploadDir}`);
  console.log(`  AI 识别/解读: ${llm ? `已启用 (${llm.textModel})` : '未配置 LLM_API_KEY，手动录入模式'}`);
  console.log(`  访问码保护:  ${CONFIG.accessCode ? '已开启' : '未开启'}`);
});
