// Vision extraction (US-03) and plain-language explanation (US-10) through an
// OpenAI-compatible chat/completions endpoint. Works with OpenAI, DeepSeek,
// Zhipu, Qwen (DashScope compatible mode), Gemini's OpenAI bridge, Ollama, etc.
// When LLM_API_KEY is unset, every helper degrades gracefully and the app
// stays fully usable through manual entry.

import { lookupBuiltin, parseRefText } from './logic.mjs';

export function llmConfig(env = process.env) {
  const apiKey = env.LLM_API_KEY;
  if (!apiKey) return null;
  const baseUrl = String(env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const visionModel = env.LLM_VISION_MODEL || 'gpt-4o-mini';
  return {
    apiKey,
    baseUrl,
    visionModel,
    textModel: env.LLM_TEXT_MODEL || visionModel
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

const EXTRACT_SYSTEM = `你是医学检验报告单识别助手。用户发来一张报告单照片或 PDF 页面。
仔细读出以下信息并输出一个严格的 JSON 对象（不要输出其他文字）：
{
  "quality": "good 或 unreadable（照片模糊、反光、倾斜到无法可靠读数时用 unreadable）",
  "reportType": "报告类型，如 血常规、尿常规、肝功能",
  "hospital": "医院或检验机构名称，读不出就留空字符串",
  "collectedAt": "采样/报告日期，格式 YYYY-MM-DD，读不出就留空字符串",
  "items": [
    { "name": "项目中文名", "display": "英文缩写，没有就留空", "value": 数值, "unit": "单位",
      "refLow": 参考下限或 null, "refHigh": 参考参考上限或 null, "refText": "报告上印的参考范围原文，没有就留空" }
  ]
}
注意：只提取报告上真实印刷的内容，不要编造；数值保持报告原样。`;

export async function extractReport(cfg, dataUrl) {
  try {
    const content = await chat(cfg, cfg.visionModel, [
      { role: 'system', content: EXTRACT_SYSTEM },
      {
        role: 'user',
        content: [
          { type: 'text', text: '请识别这张检验报告单。' },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }
    ], { maxTokens: 3000 });
    const parsed = parseJsonLoose(content);
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
        collectedAt: /^\d{4}-\d{2}-\d{2}$/.test(String(parsed.collectedAt)) ? parsed.collectedAt : ''
      },
      items
    };
  } catch (err) {
    return { ok: false, reason: `识别失败：${err.message}` };
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
  const content = await chat(cfg, cfg.textModel, [
    { role: 'system', content: EXPLAIN_SYSTEM },
    { role: 'user', content: JSON.stringify(payload) }
  ], { maxTokens: 300 });
  return content.trim();
}
