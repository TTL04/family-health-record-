// US-07: report detail view.
// Data source is a fixture for now; the API wiring lands in US-06.

export const REPORT = {
  hospital: "City People's Hospital",
  collectedAt: '2026-10-12',
  type: 'Blood routine',
  fileUrl: 'sample-report.pdf',
  items: [
    { name: 'WBC', display: 'White blood cell count', value: 11.2, unit: '10^9/L', low: 3.5, high: 9.5 },
    { name: 'RBC', display: 'Red blood cell count', value: 4.31, unit: '10^12/L', low: 3.8, high: 5.1 },
    { name: 'HGB', display: 'Haemoglobin', value: 118, unit: 'g/L', low: 115, high: 150 },
    { name: 'PLT', display: 'Platelet count', value: 96, unit: '10^9/L', low: 125, high: 350 },
    { name: 'NEUT%', display: 'Neutrophil ratio', value: 78.4, unit: '%', low: 40, high: 75 }
  ]
};

export function isAbnormal(item) {
  return item.value < item.low || item.value > item.high;
}

export function direction(item) {
  if (item.value > item.high) return 'high';
  if (item.value < item.low) return 'low';
  return 'normal';
}

export function referenceText(item) {
  return `${item.low} - ${item.high}`;
}

export function abnormalCount(items) {
  return items.filter(isAbnormal).length;
}
