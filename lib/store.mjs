// JSON-file persistence. A family-sized dataset is tiny (dozens of reports),
// so a single readable JSON file keeps self-hosting dead simple:
// backing up = copying one folder.
import fs from 'node:fs';
import path from 'node:path';

const EMPTY = { patients: [], reports: [] };

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
    } catch {
      // First run, or unreadable file — start empty.
    }
  }

  // Atomic write: temp file + rename, so a crash never truncates the data.
  save() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  upsertPatient(patient) {
    const name = String(patient.name || '').trim();
    if (!name) throw Object.assign(new Error('姓名不能为空'), { status: 400 });
    const record = {
      id: patient.id || `p_${crypto.randomUUID()}`,
      name,
      birthYear: String(patient.birthYear || '').trim(),
      gender: String(patient.gender || '').trim(),
      notes: String(patient.notes || '').trim()
    };
    const idx = this.data.patients.findIndex(p => p.id === record.id);
    if (idx >= 0) this.data.patients[idx] = record;
    else this.data.patients.push(record);
    this.save();
    return record;
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
}
