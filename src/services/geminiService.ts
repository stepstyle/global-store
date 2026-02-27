// Gemini is OPTIONAL. If no API key is set, we return a friendly message instead of crashing the app.

export async function sendMessageToGemini(message: string): Promise<string> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;

  if (!apiKey || apiKey.trim() === '' || apiKey === 'PLACEHOLDER_API_KEY') {
    return 'ميزة الشات بالذكاء الاصطناعي غير مفعّلة حالياً.';
  }

  // Lazy import so the bundle doesn't depend on it if you don't use the feature.
  const { GoogleGenerativeAI } = await import('@google/generative-ai');

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  const result = await model.generateContent(message);
  return result.response.text();
}
