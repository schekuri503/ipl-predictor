import { GoogleGenAI } from "@google/genai";
import { Match } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export const analyzeMatch = async (match: Match) => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Analyze the IPL match between ${match.homeTeam} and ${match.awayTeam} at ${match.venue}. 
      Provide a brief prediction on who might win based on historical data and team strengths. 
      Keep it short and exciting for a cricket fan.`,
      config: {
        systemInstruction: "You are an expert IPL cricket analyst. Provide concise, data-driven yet exciting match predictions.",
      },
    });
    return response.text;
  } catch (error) {
    console.error("Error analyzing match with Gemini", error);
    return "AI analysis is currently unavailable. Trust your gut!";
  }
};

export const predictWinner = async (match: Match) => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Who will win between ${match.homeTeam} and ${match.awayTeam}? Return only the team code (e.g., CSK, MI, RCB, KKR, SRH, GT, LSG, RR, DC, PBKS).`,
      config: {
        systemInstruction: "You are a cricket expert. Return ONLY the team code of the likely winner. No other text.",
      },
    });
    return response.text.trim().toUpperCase();
  } catch (error) {
    console.error("Error predicting winner with Gemini", error);
    return null;
  }
};

export const fetchOfficialResult = async (match: Match) => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Use official IPL sources first (iplt20.com, scores.iplt20.com) to find the result of IPL 2026 match between ${match.homeTeam} and ${match.awayTeam} played on ${match.date}. 
      Return a JSON object with:
      - winner: The team code (CSK, MI, RCB, KKR, SRH, GT, LSG, RR, DC, PBKS) or "DRAW" or "ABANDONED".
      - status: "COMPLETED" or "ABANDONED".
      - homeScore: The final score for ${match.homeTeam} (e.g. "185/4").
      - awayScore: The final score for ${match.awayTeam} (e.g. "172/8").
      - scoreSummary: A brief string of the final score.`,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
      },
    });
    return JSON.parse(response.text);
  } catch (error) {
    console.error("Error fetching official result", error);
    return null;
  }
};

export const fetchUpdatedSchedule = async () => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Provide the full match schedule for IPL 2026 using iplt20.com / scores.iplt20.com as primary source. 
      Return an array of objects, each containing:
      - id: unique string (e.g. match_1)
      - homeTeam: team code
      - awayTeam: team code
      - date: ISO 8601 string
      - venue: stadium name
      - type: "REGULAR", "QUARTER_FINAL", "SEMI_FINAL", or "FINAL"
      - odds: { home: number, away: number } (provide realistic points/odds for each team)`,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
      },
    });
    return JSON.parse(response.text);
  } catch (error) {
    console.error("Error fetching updated schedule", error);
    return null;
  }
};
