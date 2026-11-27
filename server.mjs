// Zero-dependency HTTP server: static client + JSON API + photo storage.
// Run with: node server.mjs   (no npm install needed)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { Store } from './lib/store.mjs';
import { validatePhoto, PHOTO_RULES } from './lib/photo.mjs';
import { normaliseEntry } from './lib/units.mjs';
import { llmConfig, extractReport, explainValue, explainDoc, analyzePatient } from './lib/llm.mjs';
import {
  abnormalCount, sortReports, explainText, lookupBuiltin, parseRefText,
  isAbnormal, direction, referenceText, DISCLAIMER
} from './lib/logic.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.join(ROOT, 'client');

// 加载 .env（零依赖，兼容 Node 18；不覆盖已存在的环境变量）。
try {
  const envText = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
  for (const line of envText.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][\w.-]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* 没有 .env 则忽略 */ }

const CONFIG = {
  port: Number(process.env.PORT) || 3000,
  dataDir: process.env.DATA_DIR || path.join(ROOT, 'data'),
  uploadDir: process.env.UPLOAD_DIR || path.join(ROOT, 'uploads')
};

const store = new Store(CONFIG.dataDir);
const llm = llmConfig();

// 本地日期（YYYY-MM-DD）。不直接用 toISOString：那是 UTC，中国早上 8 点前
// 会算成前一天，导出的文件名和导入默认日期都会差一天。
function localDate(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// AI 统一使用服务端注入的单一模型（LLM_API_KEY + deepseek-flash），
// 用户侧不再配置 Key、不再选模型。
function getLlmFor() {
  return llm;
}

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
  const raw = await readBody(req, 64 * 1024 * 1024);
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

function normalizeReport(body, user) {
  const patientId = String(body?.patientId || '');
  if (!patientId) badRequest('请先创建患者资料');
  visiblePatient(user, patientId);

  const collectedAt = String(body?.collectedAt || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(collectedAt)) badRequest('采样日期格式应为 YYYY-MM-DD');

  const items = Array.isArray(body?.items) ? body.items.map(normalizeItem) : [];
  // Lab reports carry items; narrative reports (ultrasound, CT, 病历) carry
  // organized markdown text. A report needs at least one of the two.
  const doc = String(body?.doc || '').trim().slice(0, 20000);
  if (!items.length && !doc) badRequest('至少需要一条检验项目或报告文字内容');

  const meta = {
    patientName: String(body?.meta?.patientName || '').trim().slice(0, 60),
    gender: ['男', '女'].includes(body?.meta?.gender) ? body.meta.gender : '',
    age: String(body?.meta?.age || '').trim().replace(/\D/g, '').slice(0, 3),
    department: String(body?.meta?.department || '').trim().slice(0, 60),
    doctor: String(body?.meta?.doctor || '').trim().slice(0, 60)
  };
  const metaEmpty = !meta.patientName && !meta.gender && !meta.age && !meta.department && !meta.doctor;

  return {
    id: `r_${crypto.randomUUID().slice(0, 8)}`,
    patientId,
    type: String(body?.type || '').trim() || '报告',
    hospital: String(body?.hospital || '').trim(),
    collectedAt,
    photo: typeof body?.photo === 'string' && body.photo.startsWith('/uploads/') ? body.photo : null,
    createdAt: new Date().toISOString(),
    items,
    doc,
    meta: metaEmpty ? null : meta,
    tag: String(body?.tag || '').trim().slice(0, 20)
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

function timeline(visiblePatientIds) {
  const ids = new Set(visiblePatientIds);
  return sortReports(store.data.reports)
    .filter(r => ids.has(r.patientId))
    .map(r => {
      const { items, ...rest } = r;
      return {
        ...rest,
        itemCount: items.length,
        abnormalCount: abnormalCount(items),
        // Indicator names for the trend page's picker without refetching.
        itemNames: [...new Set(items.map(i => i.name))]
      };
    });
}

// 把一位患者的档案渲染成 Markdown（导出用）。数值项用表格保留单位、参考范围
// 和偏高/偏低标记；文字报告保留原文段落，便于打印或直接发给医生。
function patientMarkdown(patient) {
  const cell = v => String(v ?? '').replace(/\|/g, '\\|').replace(/\s*\r?\n\s*/g, ' ').trim();
  const reports = sortReports(store.data.reports.filter(r => r.patientId === patient.id));
  const owner = store.data.users.find(u => u.id === patient.ownerUserId);
  const out = [];

  out.push(`# ${cell(patient.name)} · 健康档案`, '');
  out.push('| 项目 | 内容 |', '| --- | --- |');
  out.push(`| 出生日期 | ${cell(patient.birthDate || patient.birthYear || '未记录')} |`);
  out.push(`| 性别 | ${cell(patient.gender || '未记录')} |`);
  if (patient.notes) out.push(`| 备注 | ${cell(patient.notes)} |`);
  out.push(`| 档案管理者 | ${cell(owner?.username || '未记录')} |`);
  out.push(`| 报告数量 | ${reports.length} 份 |`);
  out.push(`| 导出时间 | ${new Date().toLocaleString('zh-CN', { hour12: false })} |`, '');
  out.push('> 本文件由「家庭健康档案」导出，仅供个人存档与就诊参考，不构成医疗诊断。', '');

  if (!reports.length) {
    out.push('---', '', '这位患者还没有录入任何报告。');
    return out.join('\n');
  }

  reports.forEach((report, i) => {
    out.push('---', '', `## ${i + 1}. ${cell(report.collectedAt)} · ${cell(report.type || '报告')}`, '');

    const m = report.meta || {};
    if (report.hospital) out.push(`- 医院：${cell(report.hospital)}`);
    if (report.tag) out.push(`- 分类：${cell(report.tag)}`);
    if (m.patientName) out.push(`- 报告姓名：${cell(m.patientName)}`);
    if (m.department) out.push(`- 科别：${cell(m.department)}`);
    if (m.doctor) out.push(`- 医师：${cell(m.doctor)}`);
    const abn = abnormalCount(report.items || []);
    out.push(`- 异常项：${abn ? `${abn} 项` : '无'}`, '');

    const items = (report.items || []).filter(it => it && it.name);
    if (items.length) {
      out.push('| 项目 | 数值 | 单位 | 参考范围 | 提示 |', '| --- | --- | --- | --- | --- |');
      for (const it of items) {
        const dir = direction(it);
        const flag = dir === 'high' ? '↑ 偏高' : dir === 'low' ? '↓ 偏低' : '正常';
        const label = it.display ? `${it.name} (${it.display})` : it.name;
        out.push(`| ${cell(label)} | ${cell(it.value)} | ${cell(it.unit || '—')} | ${cell(referenceText(it))} | ${flag} |`);
      }
      out.push('');
    }

    const doc = String(report.doc || '').trim();
    if (doc) {
      out.push('### 报告原文', '');
      for (const para of doc.split(/\r?\n/)) out.push(para.trim() ? `> ${para.trim()}` : '>');
      out.push('');
    }
  });

  return out.join('\n');
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

// ---- Sessions & per-user visibility ----

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

const SESSION_COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days, matches the store TTL

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie',
    `fhr_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_COOKIE_MAX_AGE}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'fhr_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

function requireUser(req) {
  const user = store.getUserBySession(parseCookies(req).fhr_session);
  if (!user) {
    throw Object.assign(new Error('请先登录'), { status: 401 });
  }
  return user;
}

// 管理员接口专用：仅 role=admin 的账号可访问。
function requireAdmin(req) {
  const user = requireUser(req);
  if (user.role !== 'admin') {
    throw Object.assign(new Error('需要管理员权限'), { status: 403 });
  }
  return user;
}

// Archives a user may touch: ones they own or are a member of. A 404 (not
// 403) keeps other families' archives indistinguishable from nonexistent ones.
function visiblePatient(user, patientId) {
  const patient = store.getPatient(String(patientId || ''));
  if (!patient || !store.patientVisibleTo(patient, user.id)) notFound('患者不存在');
  return patient;
}

function visibleReport(user, reportId) {
  const report = store.getReport(String(reportId || ''));
  if (!report) notFound('报告不存在');
  visiblePatient(user, report.patientId);
  return report;
}

// 写操作（删报告、编辑资料）要求是档案创建者；绑定成员只读。
function writablePatient(user, patientId) {
  const patient = visiblePatient(user, patientId);
  if (!store.patientWritableBy(patient, user.id)) {
    throw Object.assign(new Error('只有档案管理者才能修改，绑定成员仅可查看'), { status: 403 });
  }
  return patient;
}

// 新增报告要求有上传权限：创建者天然有，绑定成员需管理员开通。
function uploadPatient(user, patientId) {
  const patient = visiblePatient(user, patientId);
  if (!store.patientCanUpload(patient, user.id)) {
    throw Object.assign(new Error('你对该档案没有上传权限，仅可查看'), { status: 403 });
  }
  return patient;
}

// First-ever start on a fresh server seeds a known test account so the
// assignment's testers can sign in without a registration round-trip.
function seedTestUser() {
  if (store.data.users.length) return;
  store.createUser('test', 'test1234');
  console.log('  测试账号:   test / test1234（首次启动自动创建）');
}

// 确保存在一个管理员账号，密码来自环境变量 ADMIN_PASSWORD（默认 admin1234）。
function ensureAdmin() {
  const password = process.env.ADMIN_PASSWORD || 'admin1234';
  const admin = store.ensureAdmin(password);
  if (admin) console.log(`  管理员账号: admin / ${password}（首次启动自动创建，请及时修改）`);
}

async function handleApi(req, res, pathname) {
  // ---- Open auth endpoints ----
  if (req.method === 'POST' && pathname === '/api/auth/register') {
    const body = await readJson(req);
    if (String(body.password || '') !== String(body.confirm || '')) {
      badRequest('两次输入的密码不一致');
    }
    const user = store.createUser(body.username, body.password);
    setSessionCookie(res, store.createSession(user.id));
    return sendJson(res, 200, { id: user.id, username: user.username });
  }
  if (req.method === 'POST' && pathname === '/api/auth/login') {
    const body = await readJson(req);
    const user = store.verifyLogin(body.username, body.password);
    if (!user) return sendJson(res, 401, { error: '用户名或密码不对' });
    setSessionCookie(res, store.createSession(user.id));
    return sendJson(res, 200, { id: user.id, username: user.username });
  }
  if (req.method === 'POST' && pathname === '/api/auth/logout') {
    store.dropSession(parseCookies(req).fhr_session);
    clearSessionCookie(res);
    return sendJson(res, 200, { ok: true });
  }

  // Everything below requires a signed-in session.
  const user = requireUser(req);

  if (req.method === 'GET' && pathname === '/api/auth/me') {
    return sendJson(res, 200, { id: user.id, username: user.username, role: user.role || 'user' });
  }

  // 管理员：账户与 AI 用量统计（仅 admin）。
  if (req.method === 'GET' && pathname === '/api/admin/stats') {
    requireAdmin(req);
    return sendJson(res, 200, store.adminStats());
  }

  // 「我的档案管理」：自己作为管理者的档案 + 绑定成员的上传权限。
  // 超级管理员（role=admin）可总览全部档案。
  if (req.method === 'GET' && pathname === '/api/admin/members') {
    return sendJson(res, 200, store.adminMembers(user.role === 'admin' ? null : user.id));
  }
  if (req.method === 'POST' && pathname === '/api/admin/upload-permission') {
    const body = await readJson(req);
    const patientId = String(body?.patientId || '');
    const userId = String(body?.userId || '');
    if (!patientId || !userId) badRequest('缺少档案或用户');
    const patient = store.getPatient(patientId);
    if (!patient) notFound('档案不存在');
    // 只有该档案的管理者（创建者）或超级管理员能授权上传。
    if (patient.ownerUserId !== user.id && user.role !== 'admin') {
      throw Object.assign(new Error('只有该档案的管理者可以设置上传权限'), { status: 403 });
    }
    if (userId === patient.ownerUserId) badRequest('档案管理者本身已可上传');
    store.setUploadPermission(patientId, userId, Boolean(body.allowed));
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && pathname === '/api/state') {
    const visible = store.patientsForUser(user.id);
    return sendJson(res, 200, {
      user: { id: user.id, username: user.username, role: user.role || 'user' },
      aiEnabled: Boolean(llm),
      aiModel: 'DeepSeek V4.1 Flash',
      patients: visible.map(p => ({ ...store.maskPatient(p), canUpload: store.patientCanUpload(p, user.id) })),
      // Archives from before accounts existed, waiting to be adopted.
      unclaimed: store.unclaimedPatients().map(p => ({
        id: p.id,
        name: p.name,
        reportCount: store.data.reports.filter(r => r.patientId === p.id).length
      })),
      reports: timeline(visible.map(p => p.id)),
      disclaimer: DISCLAIMER
    });
  }

  // 导出单个患者的完整档案为 Markdown：可读、可打印、可直接发给医生。
  // 只能导出自己有权查看的档案；本版本不提供导入恢复。
  const exportMatch = /^\/api\/export\/patient\/([\w-]+)$/.exec(pathname);
  if (req.method === 'GET' && exportMatch) {
    const patient = visiblePatient(user, exportMatch[1]);
    const date = localDate();
    const filename = `${patient.name}-健康档案-${date}.md`;
    res.writeHead(200, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition':
        `attachment; filename="health-record-${date}.md"; filename*=UTF-8''${encodeURIComponent(filename)}`
    });
    return res.end(patientMarkdown(patient));
  }

  // Abnormal-item overview: every out-of-range value the viewer can see,
  // newest first, for the dashboard's red-flag summary.
  if (req.method === 'GET' && pathname === '/api/alerts') {
    const visible = store.patientsForUser(user.id);
    const idSet = new Set(visible.map(p => p.id));
    const nameOf = id => visible.find(p => p.id === id)?.name || '';
    const alerts = [];
    for (const report of sortReports(store.data.reports)) {
      if (!idSet.has(report.patientId)) continue;
      for (const item of report.items) {
        if (!isAbnormal(item)) continue;
        alerts.push({
          patientId: report.patientId,
          patientName: nameOf(report.patientId),
          reportId: report.id,
          reportType: report.type,
          hospital: report.hospital,
          collectedAt: report.collectedAt,
          item: {
            id: item.id,
            name: item.name,
            display: item.display,
            value: item.value,
            unit: item.unit,
            refText: referenceText(item),
            direction: direction(item)
          }
        });
      }
    }
    return sendJson(res, 200, { alerts });
  }

  // Join a family archive by its 6-character bind code. Matching an
  // unclaimed archive adopts it outright.
  if (req.method === 'POST' && pathname === '/api/bind') {
    const body = await readJson(req);
    const patient = store.bindPatientByCode(body.code, user.id);
    return sendJson(res, 200, store.maskPatient(patient));
  }

  // Adopt an unclaimed archive directly from the dashboard list (no code
  // needed — the list itself is only visible to signed-in accounts).
  const claimMatch = /^\/api\/patients\/([\w-]+)\/claim$/.exec(pathname);
  if (req.method === 'POST' && claimMatch) {
    const patient = store.claimPatient(claimMatch[1], user.id);
    return sendJson(res, 200, store.maskPatient(patient));
  }

  if (req.method === 'POST' && pathname === '/api/patients') {
    const body = await readJson(req);
    if (body.id) {
      writablePatient(user, body.id);
    } else {
      body.ownerUserId = user.id;
    }
    return sendJson(res, 200, store.upsertPatient(body));
  }

  // 解除绑定：被绑定的成员自己退出这份档案（创建者不能用，只能删除档案）。
  const unbindMatch = /^\/api\/patients\/([\w-]+)\/unbind$/.exec(pathname);
  if (req.method === 'POST' && unbindMatch) {
    const patient = visiblePatient(user, unbindMatch[1]);
    if (patient.ownerUserId === user.id) {
      badRequest('你是这份档案的管理者，不能解除绑定；若要移除请用「删除档案」');
    }
    store.removeMember(patient.id, user.id);
    return sendJson(res, 200, { ok: true });
  }

  // 删除档案（仅创建者）：档案连同它的全部报告一起删除。
  const patientOneMatch = /^\/api\/patients\/([\w-]+)$/.exec(pathname);
  if (req.method === 'DELETE' && patientOneMatch) {
    const patient = visiblePatient(user, patientOneMatch[1]);
    if (!store.patientWritableBy(patient, user.id)) {
      throw Object.assign(new Error('只有档案管理者可以删除这份档案'), { status: 403 });
    }
    store.deletePatient(patient.id);
    return sendJson(res, 200, { ok: true });
  }

  // US-02: photo upload (kept for compatibility; the AI flow no longer stores photos).
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
    uploadPatient(user, String(body?.patientId || ''));
    return sendJson(res, 200, store.addReport(normalizeReport(body, user)));
  }

  const reportMatch = /^\/api\/reports\/([\w-]+)$/.exec(pathname);
  if (reportMatch) {
    const report = visibleReport(user, reportMatch[1]);

    if (req.method === 'GET') {
      const patient = store.getPatient(report.patientId);
      return sendJson(res, 200, { ...report, isOwner: store.patientWritableBy(patient, user.id) });
    }

    // 写操作需要是档案创建者。
    writablePatient(user, report.patientId);

    // Editing an existing report keeps its id, photo and createdAt.
    if (req.method === 'PUT') {
      const body = await readJson(req);
      const next = normalizeReport(body, user);
      report.type = next.type;
      report.hospital = next.hospital;
      report.collectedAt = next.collectedAt;
      report.items = next.items;
      report.doc = next.doc;
      report.meta = next.meta;
      report.tag = next.tag;
      store.save();
      return sendJson(res, 200, report);
    }

    // US-11: deleting a report also removes its photo.
    if (req.method === 'DELETE') {
      store.deleteReport(report.id);
      deletePhotoFile(report.photo);
      return sendJson(res, 200, { ok: true });
    }
  }

  // US-03: report understanding with the patient's own key. Images and PDF
  // text are used in memory only and never written to disk.
  if (req.method === 'POST' && pathname === '/api/extract') {
    const body = await readJson(req);
    const patientId = String(body.patientId || '');
    if (!patientId) badRequest('缺少 patientId');
    visiblePatient(user, patientId);
    const cfg = getLlmFor();
    if (!cfg) return sendJson(res, 200, { ok: false, reason: 'not_configured' });
    const images = Array.isArray(body.images) ? body.images : [];
    for (const url of images) {
      const { mime } = parseDataUrl(url);
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
        badRequest('识别只支持 JPG / PNG / WebP 图片');
      }
      if (url.length > 12 * 1024 * 1024) badRequest('单张图片太大，请压缩后重试');
    }
    const texts = Array.isArray(body.texts)
      ? body.texts.map(t => String(t || '').slice(0, 100_000))
      : [];
    const result = await extractReport(cfg, { images, texts });
    store.logUsage(user.id, user.username, 'extract', `识别报告（${images.length} 图 / ${texts.length} 页文字）`);
    return sendJson(res, 200, result);
  }

  // US-09: one indicator across dates for the trend chart.
  if (req.method === 'GET' && pathname === '/api/trend') {
    const url = new URL(req.url, 'http://localhost');
    const patientId = url.searchParams.get('patientId') || '';
    const name = (url.searchParams.get('name') || '').trim();
    if (!patientId || !name) badRequest('缺少 patientId 或 name 参数');
    visiblePatient(user, patientId);
    const points = [];
    let unit = '';
    let display = '';
    let refLow = null;
    let refHigh = null;
    for (const report of sortReports(store.data.reports)) {
      if (report.patientId !== patientId) continue;
      const item = report.items.find(i =>
        i.name === name || (i.display && i.display.toLowerCase() === name.toLowerCase())
      );
      if (!item) continue;
      points.push({
        collectedAt: report.collectedAt,
        reportId: report.id,
        value: item.value,
        abnormal: abnormalCount([item]) > 0
      });
      if (!unit && item.unit) unit = item.unit;
      if (!display && item.display) display = item.display;
      if (item.refLow != null) refLow = item.refLow;
      if (item.refHigh != null) refHigh = item.refHigh;
    }
    points.sort((a, b) => String(a.collectedAt).localeCompare(String(b.collectedAt)));
    return sendJson(res, 200, { name, display, unit, refLow, refHigh, points });
  }

  // US-10: plain-language explanation with the trend since last time.
  // Uses the report owner's own AI key (falls back to the env config, then
  // to the rule-based builtin text).
  if (req.method === 'POST' && pathname === '/api/explain') {
    const body = await readJson(req);
    const report = visibleReport(user, String(body.reportId || ''));
    const item = report.items.find(i => i.id === String(body.itemId || ''));
    if (!item) notFound('检验项目不存在');
    const prev = findPrevItem(report, item);
    const cfg = getLlmFor();
    if (cfg) {
      try {
        const text = await explainValue(cfg, item, prev);
        store.logUsage(user.id, user.username, 'explain', `解读指标「${item.name}」`);
        return sendJson(res, 200, { text, source: 'ai' });
      } catch (err) {
        console.error('explain failed, falling back:', err.message);
      }
    }
    return sendJson(res, 200, { text: explainText(item, prev), source: 'builtin' });
  }

  // 报告级整体分析：叙述性报告（doc）走整份解读，检验项报告（items）走指标综合分析。
  if (req.method === 'POST' && pathname === '/api/explain/report') {
    const body = await readJson(req);
    const report = visibleReport(user, String(body.reportId || ''));
    const cfg = getLlmFor();
    if (!cfg) return sendJson(res, 200, { ok: false, error: 'AI 尚未启用（服务端未配置 LLM_API_KEY）' });
    try {
      let text;
      if (report.doc) {
        text = await explainDoc(cfg, report.doc);
      } else if (report.items.length) {
        const patient = store.getPatient(report.patientId) || { name: '' };
        text = await analyzePatient(cfg, patient, [report]);
      } else {
        return sendJson(res, 200, { ok: false, error: '这份报告没有可分析的内容' });
      }
      store.logUsage(user.id, user.username, 'explain_report', `分析报告「${report.type}」`);
      return sendJson(res, 200, { ok: true, text, source: 'ai' });
    } catch (err) {
      return sendJson(res, 200, { ok: false, error: String(err.message || err).slice(0, 200) });
    }
  }

  // 患者级整体分析：汇总一位家人的全部报告，做通俗的整体解读。
  if (req.method === 'POST' && pathname === '/api/analyze/patient') {
    const body = await readJson(req);
    const patientId = String(body.patientId || '');
    const patient = visiblePatient(user, patientId);
    const cfg = getLlmFor();
    if (!cfg) return sendJson(res, 200, { ok: false, error: 'AI 尚未启用（服务端未配置 LLM_API_KEY）' });
    const reports = sortReports(store.data.reports).filter(r => r.patientId === patientId);
    if (!reports.length) return sendJson(res, 200, { ok: false, error: '这位家人还没有报告，无法分析' });
    try {
      const text = await analyzePatient(cfg, patient, reports);
      store.logUsage(user.id, user.username, 'analyze_patient', `整体分析「${patient.name}」`);
      return sendJson(res, 200, { ok: true, text });
    } catch (err) {
      return sendJson(res, 200, { ok: false, error: String(err.message || err).slice(0, 200) });
    }
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
  seedTestUser();
  ensureAdmin();
});
