import { GoogleGenAI } from "@google/genai";

async function getSchedule() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: "Provide the first 20 matches of IPL 2026 schedule. Include Home Team, Away Team, Date (IST), Time (IST), and Venue. Return as a JSON array.",
    config: {
      tools: [{ googleSearch: {} }],
      responseMimeType: "application/json",
    },
  });
  console.log(response.text);
}

getSchedule();
