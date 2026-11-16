// Gemini is OPTIONAL. If no API key is set, we return a friendly message instead of crashing the app.
import { IS_LIVE } from '../config/deployEnv';

export async function sendMessageToGemini(message: string): Promise<string> {
  // 🛡️ Deploy guard: a sandbox build has no Gemini key in its bundle and never calls Google AI.
  const apiKey = IS_LIVE ? (import.meta.env.VITE_GEMINI_API_KEY as string | undefined) : undefined;

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
