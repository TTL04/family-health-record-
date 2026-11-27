// Vision extraction (US-03) and plain-language explanation (US-10) through an
// OpenAI-compatible chat/completions endpoint. Works with OpenAI, DeepSeek,
// Zhipu, Qwen (DashScope compatible mode), Gemini's OpenAI bridge, Ollama, etc.
// When LLM_API_KEY is unset, every helper degrades gracefully and the app
// stays fully usable through manual entry.

import { lookupBuiltin, parseRefText, referenceText } from './logic.mjs';

// 单一模型：DeepSeek V4.1 Flash（API 名 deepseek-flash），视觉识别 + 文本解读通用。
// Key 由部署方通过环境变量 LLM_API_KEY 注入，用户侧无需配置、无需选模型。
export function llmConfig(env = process.env) {
  const apiKey = env.LLM_API_KEY;
  if (!apiKey) return null;
  const baseUrl = String(env.LLM_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
  return {
    apiKey,
    baseUrl,
    visionModel: 'deepseek-flash',
    textModel: 'deepseek-flash'
  };
}

async function chat(cfg, model, messages, { maxTokens = 2000 } = {}) {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`
    },
    body: JSON.stringify({ model, messages, temperature: 0, max_tokens: maxTokens }),
    signal: AbortSignal.timeout(60_000)
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`LLM 接口返回 ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('LLM 返回格式异常');
  return content;
}

function parseJsonLoose(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('LLM 返回中找不到 JSON');
  return JSON.parse(raw.slice(start, end + 1));
}

function normalizeExtractedItem(raw) {
  const name = String(raw.name ?? raw.item ?? '').trim();
  const value = Number(raw.value);
  if (!name || !Number.isFinite(value)) return null;
  let refText = String(raw.refText ?? raw.reference ?? '').trim();
  let refLow = Number.isFinite(Number(raw.refLow)) ? Number(raw.refLow) : null;
  let refHigh = Number.isFinite(Number(raw.refHigh)) ? Number(raw.refHigh) : null;
  let unit = String(raw.unit ?? '').trim();
  let display = String(raw.display ?? raw.abbr ?? '').trim();

  const parsed = parseRefText(refText);
  if (parsed) {
    refLow = refLow ?? parsed.low;
    refHigh = refHigh ?? parsed.high;
  }
  // Report did not print a range → fall back to the builtin table.
  if (refLow == null && refHigh == null) {
    const builtin = lookupBuiltin(name) || (display ? lookupBuiltin(display) : null);
    if (builtin) {
      refLow = builtin.low;
      refHigh = builtin.high;
      unit = unit || builtin.unit;
      display = display || builtin.display;
    }
  }
  return { name, display, value, unit, refText, refLow, refHigh, corrected: false };
}

const EXTRACT_SYSTEM = `你是医院报告识别助手。用户会发来一张或多张报告的图片，或一段从报告 PDF 抽取的文字（按页分隔）。
报告可能是检验单（血常规等）、超声/CT/MRI 等影像报告、心电图、门诊病历等。
仔细读出以下信息并输出一个严格的 JSON 对象（不要输出其他文字）：
{
  "quality": "good 或 unreadable（内容模糊、残缺到无法可靠读取时用 unreadable）",
  "reportType": "报告类型，如 血常规、肝功能、超声报告、胸部CT、心电图",
  "hospital": "医院或检验机构名称，读不出就留空字符串",
  "department": "科别/科室（如 心血管内科、超声科），读不出就留空字符串",
  "patientName": "报告上的患者姓名，读不出就留空字符串",
  "gender": "男 或 女，读不出就留空字符串",
  "age": "年龄，只填数字（单位岁），读不出就留空字符串",
  "collectedAt": "检查/采样/报告日期，格式 YYYY-MM-DD，读不出就留空字符串",
  "doctor": "检查/报告/审核医师姓名，读不出就留空字符串",
  "items": [
    { "name": "项目中文名", "display": "英文缩写，没有就留空", "value": 数值, "unit": "单位",
      "refLow": 参考下限或 null, "refHigh": 参考上限或 null, "refText": "报告上印的参考范围原文，没有就留空" }
  ],
  "doc": "把整份报告按原顺序整理成 Markdown 字符串：第一行「# 报告类型（医院名）」；之后按报告原有分区用「## 区块名」组织（如 患者信息、检查部位、检查所见、超声提示/诊断意见、检验项目、医师与日期）；检验项目写成「名称 缩写: 数值 单位 (参考范围)」一行一项，异常值后加 ↑ 或 ↓；其余内容忠于原文，不增不减不改写，保持原有段落；不要 Markdown 表格语法；不要编造，不要添加任何解读或建议。读不出内容时留空字符串。"
}
注意：
- 只提取报告上真实存在的内容，不要编造；
- 数值保持报告原样；
- 多页报告要把所有页的内容合并；
- items 只收录检验类数值项目（有数值、有单位、有参考范围的那种）；检查所见、影像描述、诊断意见等文字内容全部写进 doc，不要拆成 items；
- 遇到「↑」「↓」箭头时，结合参考范围判断，不要把箭头当数值的一部分。`;

export async function extractReport(cfg, payload = {}) {
  const images = Array.isArray(payload.images) ? payload.images : [];
  const texts = Array.isArray(payload.texts)
    ? payload.texts.map(t => String(t).trim()).filter(Boolean)
    : [];

  if (!images.length && !texts.length) {
    return { ok: false, reason: '没有收到图片或文字内容' };
  }

  let msg;
  try {
    if (texts.length) {
      // Hospital-exported PDFs carry a text layer: reading the text directly
      // is cheaper and works even with text-only models (deepseek-chat 等).
      const joined = texts.map((t, i) => `--- 第 ${i + 1} 页 ---\n${t}`).join('\n\n');
      msg = await chat(cfg, cfg.textModel, [
        { role: 'system', content: EXTRACT_SYSTEM },
        { role: 'user', content: `以下是从报告 PDF 直接抽取的文字（共 ${texts.length} 页），请整理识别：\n\n${joined}` }
      ], { maxTokens: 6000 });
    } else {
      if (!cfg.visionModel) {
        return {
          ok: false,
          reason: '当前没有配置「视觉模型」：拍照/截图识别需要一个能看图的模型（如 DeepSeek deepseek-flash、智谱 glm-4v-flash、通义 qwen-vl-plus、OpenAI gpt-4o-mini）。'
        };
      }
      const multiNote = images.length > 1 ? `（共 ${images.length} 页，按顺序合并读取）` : '';
      const content = [
        { type: 'text', text: `请识别这张报告单${multiNote}。` },
        ...images.map(url => ({ type: 'image_url', image_url: { url } }))
      ];
      msg = await chat(cfg, cfg.visionModel, [
        { role: 'system', content: EXTRACT_SYSTEM },
        { role: 'user', content }
      ], { maxTokens: 6000 });
    }

    const parsed = parseJsonLoose(msg);
    const quality = parsed.quality === 'unreadable' ? 'unreadable' : 'good';
    const items = Array.isArray(parsed.items)
      ? parsed.items.map(normalizeExtractedItem).filter(Boolean)
      : [];
    return {
      ok: true,
      quality,
      fields: {
        reportType: String(parsed.reportType || '').trim(),
        hospital: String(parsed.hospital || '').trim(),
        department: String(parsed.department || '').trim(),
        patientName: String(parsed.patientName || '').trim(),
        gender: ['男', '女'].includes(parsed.gender) ? parsed.gender : '',
        age: String(parsed.age ?? '').trim().replace(/[^\d]/g, '').slice(0, 3),
        collectedAt: /^\d{4}-\d{2}-\d{2}$/.test(String(parsed.collectedAt)) ? parsed.collectedAt : '',
        doctor: String(parsed.doctor || '').trim()
      },
      items,
      doc: typeof parsed.doc === 'string' ? parsed.doc.trim().slice(0, 20000) : ''
    };
  } catch (err) {
    const msg = String(err.message || err);
    // Common case: the configured model cannot accept images.
    if (/image|vision|multimodal|不支持|content/i.test(msg)) {
      return { ok: false, reason: `识别失败：${msg}。请确认「视觉模型」填的是支持看图的模型（如 deepseek-flash、glm-4v-flash、gpt-4o-mini）` };
    }
    return { ok: false, reason: `识别失败：${msg}` };
  }
}

const EXPLAIN_SYSTEM = `你是给非医学专业的家属看的化验单解读助手。请用不超过120个汉字的通俗中文解释一个检验值：
先一句话说明这个指标大致反映什么，再说本次数值与参考范围的关系；如果提供了上次数值，必须对比变化趋势。
不要诊断疾病，不要给出治疗、用药或就医决定，只做通俗解释。直接输出解释文本，不要标题和列表。`;

export async function explainValue(cfg, item, prev) {
  const payload = {
    指标: item.name,
    英文缩写: item.display || undefined,
    本次数值: item.value,
    单位: item.unit || undefined,
    参考范围: item.refText || (item.refLow != null || item.refHigh != null
      ? `${item.refLow ?? '?'} - ${item.refHigh ?? '?'}`
      : undefined),
    上次: prev ? { 数值: prev.value, 单位: prev.unit || undefined, 日期: prev.collectedAt } : undefined
  };
  // maxTokens generous enough for reasoning-style models (deepseek-flash,
  // deepseek-v4-pro) whose hidden thinking is billed into completion tokens.
  const content = await chat(cfg, cfg.textModel, [
    { role: 'system', content: EXPLAIN_SYSTEM },
    { role: 'user', content: JSON.stringify(payload) }
  ], { maxTokens: 2000 });
  return content.trim();
}

// Structured plain-language explanation of a whole organized report
// (ultrasound, CT, 病历…) for family members who cannot read medical jargon.
// Four fixed sections: summary, term glossary, findings walkthrough, and
// points worth attention. Educational tone only — never a diagnosis, never
// treatment or medication advice.
const EXPLAIN_DOC_SYSTEM = `你是给非医学专业的家属看的报告解读助手。下面是一份整理后的医疗报告全文。
请严格按以下四个小节输出 Markdown（不要开场白和结束语，不要输出其他小节）：
## 一句话总结
不超过60个字：这份报告查了什么部位/项目，总体情况如何。
## 名词解释
从报告中挑出家属看不懂的医学术语（提示/结论里的病名、检查所见里的专业描述词），每行一条：「**术语**：一句大白话解释」，按在报告中出现的顺序排列，最多8条。只解释报告里真实出现的词，不要扩展报告外的内容。
## 主要发现是什么意思
逐条转述报告的「提示/结论/诊断意见」，每条用大白话说明这类发现通常指什么情况（可以用「通常」「一般」这类措辞介绍常见含义）；不要下确定的诊断，不要建议用药、治疗或手术。
## 值得留意的点
用一到三句话指出：哪些条目一般属于常见、多无需紧张的情况，哪些按报告措辞通常需要复查或随访复查；不确定的地方明确说「请以医生意见为准」。
只输出以上四部分内容。`;

export async function explainDoc(cfg, doc) {
  const content = await chat(cfg, cfg.textModel, [
    { role: 'system', content: EXPLAIN_DOC_SYSTEM },
    { role: 'user', content: String(doc).slice(0, 8000) }
  ], { maxTokens: 3000 });
  return content.trim();
}

// 患者级整体分析：把一位家人的多份报告汇总，做通俗的整体解读。
// 定位是「辅助查询/梳理」，不诊断、不给用药决定。
const ANALYZE_PATIENT_SYSTEM = `你是给非医学专业的家属看的健康档案解读助手。用户会提供一位家人的多份医疗报告摘要（按时间排列）。
请用通俗中文给出整体分析，严格按以下三个小节输出 Markdown（不要开场白和结束语）：
## 一句话总览
不超过60个字：这位家人查了哪些方面，整体情况如何。
## 值得关注的指标
挑出异常或变化明显的指标，逐条用大白话说明：指标名、本次数值与参考范围、相比上次的变化、通常意味着什么。最多6条；没有明显异常就说明「暂未发现明显异常指标」。
## 趋势与提醒
用2-3句说明整体趋势，并提醒：本解读仅供家属参考，不构成诊断，请以医生意见为准。
只输出以上三部分；不要诊断疾病，不要建议用药、治疗或就医决定。`;

export async function analyzePatient(cfg, patient, reports) {
  const summary = reports.map(r => {
    const items = (r.items || []).map(i =>
      `${i.name}${i.display ? `(${i.display})` : ''} ${i.value}${i.unit || ''}（参考 ${referenceText(i)}）`).join('；');
    const docLine = r.doc ? `\n文字内容：${String(r.doc).slice(0, 600)}` : '';
    return `【${r.collectedAt}】${r.type}${r.hospital ? ' · ' + r.hospital : ''}\n${items || '（文字报告）'}${docLine}`;
  }).join('\n\n');
  const content = await chat(cfg, cfg.textModel, [
    { role: 'system', content: ANALYZE_PATIENT_SYSTEM },
    { role: 'user', content: `患者姓名：${patient.name || '未命名'}\n以下按时间排列的报告：\n\n${summary}` }
  ], { maxTokens: 3000 });
  return content.trim();
}

// "测试连接" button: one tiny chat call proves baseUrl, key and model work.
export async function testConnection(cfg) {
  const model = cfg.textModel || cfg.visionModel;
  if (!model) {
    return { ok: false, error: '请填写模型名（如 deepseek-chat、glm-4-flash）再测试' };
  }
  try {
    const reply = await chat(cfg, model, [
      { role: 'user', content: '回复"OK"两个字母即可。' }
    ], { maxTokens: 200 });
    return { ok: true, reply: reply.trim().slice(0, 20) };
  } catch (err) {
    return { ok: false, error: String(err.message || err).slice(0, 300) };
  }
}

// List model ids from the provider's OpenAI-compatible GET /models endpoint
// so the user can pick a model instead of typing its name. Providers without
// such an endpoint (or a wrong key/URL) fail gracefully and the client keeps
// the manual input.
export async function listModels(cfg) {
  try {
    const res = await fetch(`${cfg.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      signal: AbortSignal.timeout(15_000)
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, error: `接口返回 ${res.status}: ${detail.slice(0, 150)}` };
    }
    const data = await res.json();
    const list = Array.isArray(data?.data)
      ? data.data.map(m => String(m?.id || '')).filter(Boolean)
      : [];
    if (!list.length) return { ok: false, error: '接口没有返回任何模型' };
    return { ok: true, models: [...new Set(list)].sort() };
  } catch (err) {
    return { ok: false, error: String(err.message || err).slice(0, 200) };
  }
}

// Build an llm config from a patient's stored settings (with presets).
// No cross-provider fallback: an empty model name stays empty so the
// caller can show a clear "请填写模型名" message instead of a confusing
// "Model Not Exist" from the wrong provider.
export function cfgFromPatient(llm) {
  if (!llm || !llm.apiKey) return null;
  return {
    baseUrl: String(llm.baseUrl || '').replace(/\/+$/, '') || 'https://open.bigmodel.cn/api/paas/v4',
    apiKey: llm.apiKey,
    visionModel: String(llm.visionModel || '').trim(),
    textModel: String(llm.textModel || llm.visionModel || '').trim()
  };
}
