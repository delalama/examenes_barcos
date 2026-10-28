export const appConfig = {
  name: "Práctica Exámenes PNB/PER/PY/CY",
  licenses: ["PNB", "PER", "PY", "CY"] as const,
  islands: ["Mallorca", "Menorca", "Ibiza"] as const,
  years: { min: 2017, max: 2026 },
  randomQuestions: 20,
  examMinutes: { PNB: 45, PER: 90, PY: 120, CY: 150 },
  grading: { penaltyWrong: 0, minimumPassPercent: 50 },
  confidence: { publish: 0.95, review: 0.7 },
  pagination: { default: 20, max: 100 },
  features: { randomPractice: true, officialExams: true, aiVision: false },
};
