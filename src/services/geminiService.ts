import { GoogleGenAI } from "@google/genai";
import { Match } from "../types";
import { trackGeminiCall } from "../firebaseTracker";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export const analyzeMatch = async (match: Match) => {
  try {
    trackGeminiCall(1);
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
    trackGeminiCall(1);
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
    trackGeminiCall(1);
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `What was the official result of the IPL 2026 match between ${match.homeTeam} and ${match.awayTeam} played on ${match.date}?
      
      CRITICAL: 
      1. If the match is still in progress (LIVE), return status: "LIVE".
      2. Only return "COMPLETED" if the match has officially concluded with a final result.
      3. If the match was abandoned or called off due to rain/other reasons, return status: "ABANDONED" and winner: "ABANDONED".
      4. Double-check the date ${match.date} to ensure you are looking at the correct match in 2026.
      
      Return a JSON object with:
      - winner: The team code (CSK, MI, RCB, KKR, SRH, GT, LSG, RR, DC, PBKS) or "DRAW" or "ABANDONED".
      - status: "COMPLETED" or "ABANDONED" or "LIVE".
      - homeScore: The final score for ${match.homeTeam} (e.g. "185/4 (20)").
      - awayScore: The final score for ${match.awayTeam} (e.g. "172/8 (20)").
      - tossWinner: The team code that won the toss (CSK, MI, RCB, KKR, SRH, GT, LSG, RR, DC, PBKS).
      - battingFirst: The team code that batted first.
      - summary: A brief 1-2 sentence match summary (e.g. "CSK won by 5 wickets. Ruturaj scored 82*").`,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
      },
    });
    const text = response.text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : text;
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error("Error fetching official result", error);
    return null;
  }
};

export const fetchLiveMatchData = async (match: Match) => {
  try {
    trackGeminiCall(1);
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `What is the current live status of the IPL 2026 cricket match: ${match.homeTeam} vs ${match.awayTeam} scheduled on ${match.dateIST} at ${match.venue}?
      Current Date/Time (UTC): ${new Date().toISOString()}
      Check official sources like iplt20.com. Ensure you are checking the correct match for the year 2026.
      
      Return a JSON object with:
      - status: "UPCOMING", "LIVE", or "COMPLETED"
      - winner: The winning team code (CSK, MI, RCB, KKR, SRH, GT, LSG, RR, DC, PBKS) if completed, null otherwise
      - homeScore: Current/final score for ${match.homeTeam} (e.g. "185/4 (20)")
      - awayScore: Current/final score for ${match.awayTeam}
      - tossWinner: Winning team code
      - battingFirst: BATTING first team code
      - summary: Brief description`,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
      },
    });
    const text = response.text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : text;
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error("Error fetching live match data", error);
    return null;
  }
};

export const fetchUpdatedSchedule = async () => {
  try {
    trackGeminiCall(1);
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Provide the full match schedule for IPL 2026. 
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