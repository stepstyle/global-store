// The TWO real Workers AI answers recorded on 2026-11-05 (staging account, @cf/meta/llama-3.3-70b-instruct-fp8-fast),
// exactly as returned by workers/ai-discovery (POST /ai/intent -> body.intent). Fixed test data: replayed, never re-requested.
export const REAL_AI_RESPONSES = Object.freeze([
  {
    query: 'بدي هدية تعليمية لطفل عمره 7 سنوات بحدود 12 دينار',
    model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    httpStatus: 200,
    intent: {
      age: { min: 7, max: 7, phrase: '' },
      recipient: 'child',
      categories: ['EducationalCards', 'Games'],
      keywords: ['هدية تعليمية', 'طفل', 'دينار 12'],
    },
  },
  {
    query: 'بدي هدية لأستاذة، بس مش ألعاب أطفال',
    model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    httpStatus: 200,
    intent: {
      recipient: 'adult',
      excludeCategories: ['Games'],
    },
  },
]);
