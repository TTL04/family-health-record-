// JSON-file persistence. A family-sized dataset is tiny (dozens of reports),
// so a single readable JSON file keeps self-hosting dead simple:
// backing up = copying one folder.
import fs from 'node:fs';
import path from 'node:path';
import { hashPassword, verifyPassword, newSessionToken, newBindCode } from './auth.mjs';

const EMPTY = {
  patients: [],
  reports: [],
  settings: { llm: null },
  users: [],
  sessions: {},
  usageLog: []
};

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'app-data.json');
    this.data = structuredClone(EMPTY);
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = { ...structuredClone(EMPTY), ...parsed };
      this.data.settings = { ...structuredClone(EMPTY.settings), ...(parsed.settings || {}) };
      this.data.sessions = { ...(parsed.sessions || {}) };
    } catch {
      // First run, or unreadable file — start empty.
    }
    this.migrate();
    this.pruneSessions();
  }

  // One-time upgrades: app-level AI config adoption; bind codes for every
  // patient (binding lets another family account follow an archive).
  migrate() {
    if (!this.data.settings.llm) {
      const donor = this.data.patients.find(p => p.llm?.apiKey);
      if (donor) {
        this.data.settings.llm = { ...donor.llm };
        this.save();
      }
    }
    let changed = false;
    for (const p of this.data.patients) {
      if (!p.bindCode) { p.bindCode = newBindCode(); changed = true; }
      if (!Array.isArray(p.members)) { p.members = []; changed = true; }
      if (!Array.isArray(p.uploaders)) { p.uploaders = []; changed = true; }
      if (!p.birthDate && p.birthYear) { p.birthDate = String(p.birthYear); changed = true; }
    }
    for (const u of this.data.users) {
      if (!u.role) { u.role = 'user'; changed = true; }
    }
    if (!Array.isArray(this.data.usageLog)) { this.data.usageLog = []; changed = true; }
    if (changed) this.save();
  }

  pruneSessions() {
    const now = Date.now();
    let changed = false;
    for (const [token, session] of Object.entries(this.data.sessions)) {
      if (!session || session.expiresAt < now) {
        delete this.data.sessions[token];
        changed = true;
      }
    }
    if (changed) this.save();
  }

  // Atomic write: temp file + rename, so a crash never truncates the data.
  // The file may hold API keys, so keep it owner-only.
  save() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
    try { fs.chmodSync(this.file, 0o600); } catch { /* best effort */ }
  }

  upsertPatient(patient) {
    const name = String(patient.name || '').trim();
    if (!name) throw Object.assign(new Error('姓名不能为空'), { status: 400 });
    const existing = this.data.patients.find(p => p.id === patient.id);

    // AI settings live on the patient record (one key per family).
    // A masked key coming back from the browser must never overwrite
    // the real one stored on the server.
    let llm = existing?.llm || null;
    if (patient.llm !== undefined) {
      if (patient.llm === null) {
        llm = null;
      } else {
        const incomingKey = String(patient.llm.apiKey || '').trim();
        const keepKey = !incomingKey || incomingKey.includes('•');
        llm = {
          baseUrl: String(patient.llm.baseUrl || '').trim(),
          apiKey: keepKey ? (existing?.llm?.apiKey || '') : incomingKey,
          visionModel: String(patient.llm.visionModel || '').trim(),
          textModel: String(patient.llm.textModel || '').trim()
        };
        if (!llm.apiKey) llm = null;
      }
    }

    const record = {
      id: patient.id || `p_${crypto.randomUUID()}`,
      name,
      // Partial updates (e.g. saving only AI settings) must not wipe
      // fields the caller did not send.
      birthDate: patient.birthDate !== undefined ? String(patient.birthDate).trim() : (existing?.birthDate || ''),
      gender: patient.gender !== undefined ? String(patient.gender).trim() : (existing?.gender || ''),
      notes: patient.notes !== undefined ? String(patient.notes).trim() : (existing?.notes || ''),
      llm,
      ownerUserId: existing?.ownerUserId || patient.ownerUserId || null,
      members: Array.isArray(existing?.members) ? existing.members : [],
      uploaders: Array.isArray(existing?.uploaders) ? existing.uploaders : [],
      bindCode: existing?.bindCode || newBindCode()
    };
    const idx = this.data.patients.findIndex(p => p.id === record.id);
    if (idx >= 0) this.data.patients[idx] = record;
    else this.data.patients.push(record);
    this.save();
    return this.maskPatient(record);
  }

  // Never send raw API keys to the browser — only a hint like "…abcd".
  // bindCode is only ever returned for archives the viewer can already see.
  maskPatient(patient) {
    const { llm, ...rest } = patient;
    return {
      ...rest,
      bindCode: patient.bindCode || null,
      llmConfigured: Boolean(llm?.apiKey),
      llmHint: llm?.apiKey ? `…${llm.apiKey.slice(-4)}` : null,
      llmBaseUrl: llm?.baseUrl || null,
      llmModels: llm ? { visionModel: llm.visionModel, textModel: llm.textModel } : null
    };
  }

  maskedPatients() {
    return this.data.patients.map(p => this.maskPatient(p));
  }

  // App-level AI config shared by all patients. A patient may still override
  // it with their own key (llm on the patient record).
  upsertSettingsLlm(llm) {
    let next = this.data.settings.llm;
    if (llm === null) {
      next = null;
    } else {
      const incomingKey = String(llm.apiKey || '').trim();
      const keepKey = !incomingKey || incomingKey.includes('•');
      next = {
        baseUrl: String(llm.baseUrl || '').trim(),
        apiKey: keepKey ? (this.data.settings.llm?.apiKey || '') : incomingKey,
        visionModel: String(llm.visionModel || '').trim(),
        textModel: String(llm.textModel || '').trim()
      };
      if (!next.apiKey) next = null;
    }
    this.data.settings.llm = next;
    this.save();
    return this.maskedSettings();
  }

  maskedSettings() {
    const llm = this.data.settings.llm;
    return {
      aiConfigured: Boolean(llm?.apiKey),
      aiHint: llm?.apiKey ? `…${llm.apiKey.slice(-4)}` : null,
      aiBaseUrl: llm?.baseUrl || null,
      aiModels: llm ? { visionModel: llm.visionModel, textModel: llm.textModel } : null
    };
  }

  getPatient(id) {
    return this.data.patients.find(p => p.id === id) || null;
  }

  // ---- Accounts & sessions ----

  createUser(username, password, role = 'user') {
    const name = String(username || '').trim();
    if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]{2,24}$/.test(name)) {
      throw Object.assign(new Error('用户名应为 2-24 位字母、数字、下划线或中文'), { status: 400 });
    }
    if (String(password || '').length < 6) {
      throw Object.assign(new Error('密码至少 6 位'), { status: 400 });
    }
    const key = name.toLowerCase();
    if (this.data.users.some(u => u.username.toLowerCase() === key)) {
      throw Object.assign(new Error('这个用户名已被使用'), { status: 400 });
    }
    const user = {
      id: `u_${crypto.randomUUID().slice(0, 8)}`,
      username: name,
      role: role === 'admin' ? 'admin' : 'user',
      passHash: hashPassword(password),
      createdAt: new Date().toISOString()
    };
    this.data.users.push(user);
    this.save();
    return user;
  }

  findUserByUsername(username) {
    const key = String(username || '').trim().toLowerCase();
    return this.data.users.find(u => u.username.toLowerCase() === key) || null;
  }

  verifyLogin(username, password) {
    const user = this.findUserByUsername(username);
    // Same failure path for unknown user and wrong password (no user probing).
    if (!user || !verifyPassword(password, user.passHash)) return null;
    return user;
  }

  createSession(userId) {
    const token = newSessionToken();
    this.data.sessions[token] = { userId, expiresAt: Date.now() + SESSION_TTL_MS };
    this.save();
    return token;
  }

  getUserBySession(token) {
    const session = this.data.sessions[String(token || '')];
    if (!session || session.expiresAt < Date.now()) return null;
    return this.data.users.find(u => u.id === session.userId) || null;
  }

  dropSession(token) {
    if (this.data.sessions[String(token || '')]) {
      delete this.data.sessions[token];
      this.save();
    }
  }

  // ---- Archive visibility & binding ----

  patientVisibleTo(patient, userId) {
    return Boolean(userId && patient &&
      (patient.ownerUserId === userId || (Array.isArray(patient.members) && patient.members.includes(userId))));
  }

  // 只有档案的创建者（owner）可以删除报告、编辑资料；绑定成员只读。
  patientWritableBy(patient, userId) {
    return Boolean(userId && patient && patient.ownerUserId === userId);
  }

  // 上传权限：创建者天然可上传；绑定成员需管理员单独开通后也能新增报告。
  patientCanUpload(patient, userId) {
    return Boolean(userId && patient &&
      (patient.ownerUserId === userId ||
        (Array.isArray(patient.uploaders) && patient.uploaders.includes(userId))));
  }

  patientsForUser(userId) {
    return this.data.patients.filter(p => this.patientVisibleTo(p, userId));
  }

  unclaimedPatients() {
    return this.data.patients.filter(p => !p.ownerUserId);
  }

  claimPatient(patientId, userId) {
    const p = this.getPatient(patientId);
    if (!p) throw Object.assign(new Error('档案不存在'), { status: 404 });
    if (p.ownerUserId && p.ownerUserId !== userId) {
      throw Object.assign(new Error('这份档案已由其他账号创建'), { status: 400 });
    }
    if (!p.ownerUserId) p.ownerUserId = userId;
    if (!Array.isArray(p.members)) p.members = [];
    if (!p.members.includes(userId)) p.members.push(userId);
    this.save();
    return p;
  }

  // 删除档案（仅创建者）：连同它的全部报告一起移除，避免孤儿数据。
  deletePatient(patientId) {
    const idx = this.data.patients.findIndex(p => p.id === patientId);
    if (idx < 0) return null;
    const [removed] = this.data.patients.splice(idx, 1);
    this.data.reports = this.data.reports.filter(r => r.patientId !== patientId);
    this.save();
    return removed;
  }

  // 解除绑定：被绑定的成员自己退出这份档案，同时收回上传权限。
  removeMember(patientId, userId) {
    const p = this.getPatient(patientId);
    if (!p) throw Object.assign(new Error('档案不存在'), { status: 404 });
    p.members = (p.members || []).filter(id => id !== userId);
    p.uploaders = (p.uploaders || []).filter(id => id !== userId);
    this.save();
    return p;
  }

  bindPatientByCode(code, userId) {
    const key = String(code || '').trim().toUpperCase();
    const p = this.data.patients.find(x => x.bindCode === key);
    if (!p) throw Object.assign(new Error('绑定码不对，请核对后再试'), { status: 400 });
    if (!p.ownerUserId) {
      // Unclaimed archives are adopted outright with a matching code.
      return this.claimPatient(p.id, userId);
    }
    if (!Array.isArray(p.members)) p.members = [];
    if (!p.members.includes(userId)) {
      p.members.push(userId);
      this.save();
    }
    return p;
  }

  // 管理员给绑定成员开通/取消「上传权限」。
  setUploadPermission(patientId, userId, allowed) {
    const p = this.getPatient(patientId);
    if (!p) throw Object.assign(new Error('档案不存在'), { status: 404 });
    if (!Array.isArray(p.uploaders)) p.uploaders = [];
    const has = p.uploaders.includes(userId);
    if (allowed && !has) p.uploaders.push(userId);
    if (!allowed && has) p.uploaders = p.uploaders.filter(id => id !== userId);
    this.save();
    return p;
  }

  addReport(report) {
    this.data.reports.push(report);
    this.save();
    return report;
  }

  getReport(id) {
    return this.data.reports.find(r => r.id === id) || null;
  }

  deleteReport(id) {
    const idx = this.data.reports.findIndex(r => r.id === id);
    if (idx < 0) return null;
    const [removed] = this.data.reports.splice(idx, 1);
    this.save();
    return removed;
  }

  // ---- AI 调用日志 & 管理员统计 ----

  logUsage(userId, username, type, detail = '') {
    if (!Array.isArray(this.data.usageLog)) this.data.usageLog = [];
    this.data.usageLog.push({
      id: `l_${crypto.randomUUID().slice(0, 8)}`,
      userId,
      username,
      type,
      detail,
      at: new Date().toISOString()
    });
    if (this.data.usageLog.length > 1000) this.data.usageLog = this.data.usageLog.slice(-1000);
    this.save();
  }

  // 管理员视图：每个账户的档案/报告数 + 调用次数 + 最近调用记录。
  adminStats() {
    const usageLog = this.data.usageLog || [];
    const byUser = new Map();
    for (const u of this.data.users) {
      byUser.set(u.id, {
        id: u.id,
        username: u.username,
        role: u.role || 'user',
        createdAt: u.createdAt,
        patientCount: this.data.patients.filter(p => p.ownerUserId === u.id).length,
        reportCount: this.data.reports.filter(r => {
          const p = this.data.patients.find(x => x.id === r.patientId);
          return p && p.ownerUserId === u.id;
        }).length,
        usageCount: 0
      });
    }
    for (const l of usageLog) {
      const u = byUser.get(l.userId);
      if (u) u.usageCount++;
    }
    return {
      totalUsers: this.data.users.length,
      totalPatients: this.data.patients.length,
      totalReports: this.data.reports.length,
      totalUsage: usageLog.length,
      users: [...byUser.values()],
      recentUsage: usageLog.slice(-50).reverse()
    };
  }

  // 管理者视图：每份档案的创建者 + 绑定成员及各自的上传权限。
  // 传 ownerUserId 时只看该用户创建的档案（普通用户的「我的档案管理」）；
  // 不传则返回全部（超级管理员总览）。
  adminMembers(ownerUserId = null) {
    const username = id => {
      const u = this.data.users.find(x => x.id === id);
      return u ? u.username : '未知';
    };
    const list = ownerUserId
      ? this.data.patients.filter(p => p.ownerUserId === ownerUserId)
      : this.data.patients;
    return list.map(p => ({
      id: p.id,
      name: p.name,
      owner: username(p.ownerUserId),
      isOwner: ownerUserId ? p.ownerUserId === ownerUserId : null,
      members: (p.members || [])
        .filter(id => id !== p.ownerUserId)
        .map(id => ({
          userId: id,
          username: username(id),
          canUpload: (p.uploaders || []).includes(id)
        }))
    }));
  }

  // 确保存在一个管理员账号（用户名 admin，密码由部署方传入）。
  ensureAdmin(password) {
    if (this.data.users.some(u => u.role === 'admin')) return null;
    const admin = {
      id: `u_${crypto.randomUUID().slice(0, 8)}`,
      username: 'admin',
      role: 'admin',
      passHash: hashPassword(password),
      createdAt: new Date().toISOString()
    };
    this.data.users.push(admin);
    this.save();
    return admin;
  }

  // ---- Backup & restore ----

  // Full snapshot for backup. Sessions are deliberately excluded: they are
  // transient login state and shipping them would leak live tokens.
  exportSnapshot() {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      patients: structuredClone(this.data.patients),
      reports: structuredClone(this.data.reports),
      settings: structuredClone(this.data.settings),
      users: structuredClone(this.data.users)
    };
  }

  // Merge-import a backup file. Never deletes or overwrites existing records:
  // it only fills gaps by id (and by username for accounts). The importer's
  // account is added as a member of every imported archive so the data is
  // immediately visible after a restore. Sessions are ignored.
  importSnapshot(snapshot, userId) {
    if (!snapshot || typeof snapshot !== 'object') {
      throw Object.assign(new Error('备份文件格式不正确'), { status: 400 });
    }
    const patients = Array.isArray(snapshot.patients) ? snapshot.patients : [];
    const reports = Array.isArray(snapshot.reports) ? snapshot.reports : [];
    const users = Array.isArray(snapshot.users) ? snapshot.users : [];
    const counts = { patients: 0, reports: 0, users: 0 };

    for (const u of users) {
      if (!u || typeof u.id !== 'string' || !u.id) continue;
      if (this.data.users.some(x => x.id === u.id)) continue;
      const uname = String(u.username || '').trim().toLowerCase();
      if (!uname || this.data.users.some(x => x.username.toLowerCase() === uname)) continue;
      this.data.users.push({
        id: u.id,
        username: String(u.username || '').trim(),
        passHash: String(u.passHash || ''),
        createdAt: u.createdAt || new Date().toISOString()
      });
      counts.users++;
    }

    for (const p of patients) {
      if (!p || typeof p.id !== 'string' || !p.id) continue;
      if (this.data.patients.some(x => x.id === p.id)) continue;
      const record = structuredClone(p);
      if (!Array.isArray(record.members)) record.members = [];
      if (userId && !record.members.includes(userId)) record.members.push(userId);
      if (!record.bindCode) record.bindCode = newBindCode();
      this.data.patients.push(record);
      counts.patients++;
    }

    for (const r of reports) {
      if (!r || typeof r.id !== 'string' || !r.id) continue;
      if (this.data.reports.some(x => x.id === r.id)) continue;
      this.data.reports.push(structuredClone(r));
      counts.reports++;
    }

    // Adopt the backup's app-level AI key only when none is configured yet.
    if (!this.data.settings.llm && snapshot.settings?.llm?.apiKey) {
      this.data.settings.llm = structuredClone(snapshot.settings.llm);
    }

    this.save();
    return counts;
  }
}
