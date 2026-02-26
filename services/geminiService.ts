
import { GoogleGenAI, Chat } from "@google/genai";
import { db } from "./storage";
import { Product } from "../types";

// Retrieve API key safely
const apiKey = process.env.API_KEY || '';

const ai = new GoogleGenAI({ apiKey });

let chatSession: Chat | null = null;

export const getChatSession = async () => {
  if (!chatSession) {
    // Load products dynamically from the database/API to ensure context is up-to-date
    let products: Product[] = [];
    try {
        products = await db.products.getAll();
    } catch (e) {
        console.error("Failed to fetch products for AI context", e);
    }

    // Limit context to top 50 items to manage token usage and latency
    // In a production app, RAG (Retrieval Augmented Generation) would be used here for large datasets
    const productContext = products.slice(0, 50).map(p => 
      `- ${p.name} (${p.category}): ${p.price} SAR. Rating: ${p.rating}. ${p.stock > 0 ? 'In Stock' : 'Out of Stock'}`
    ).join('\n');

    const systemInstruction = `
You are "Anta Bot", the intelligent assistant for "Anta Store", a modern e-commerce shop selling stationery, bags, art supplies, courses, and games.
Your tone should be friendly, tech-savvy, and helpful.
You speak primarily in Arabic, but can switch to English if the user speaks English.

Here is our current product catalog (partial view):
${productContext}

Your responsibilities:
1. Recommend products based on user needs from the catalog provided.
2. Answer questions about product details.
3. If a user asks for "offers" or "sales", highlight items with an 'originalPrice' higher than 'price'.
4. Keep answers concise (under 100 words) unless detailed explanation is requested.
5. If you don't know an answer or the product isn't listed, politely ask them to contact support at support@antastore.com.
`;

    chatSession = ai.chats.create({
      model: 'gemini-2.5-flash',
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.7,
      },
    });
  }
  return chatSession;
};

export const sendMessageToGemini = async (message: string): Promise<string> => {
  try {
    const chat = await getChatSession();
    const response = await chat.sendMessage({ message });
    return response.text || "عذراً، لم أتمكن من فهم ذلك.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    // Reset session in case of error (e.g. token expiry or context issues) to force refresh on next retry
    chatSession = null;
    return "عذراً، حدث خطأ في الاتصال بالخادم. يرجى المحاولة لاحقاً.";
  }
};
