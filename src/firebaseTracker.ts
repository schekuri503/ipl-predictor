/**
 * Client-side Firebase usage tracker.
 * Tracks Firestore read/write/delete operations per day in localStorage.
 * Shows approximate usage vs Firebase free tier limits.
 */

const STORAGE_KEY = 'fb_usage';

interface DailyUsage {
  date: string;
  reads: number;
  writes: number;
  deletes: number;
  geminiCalls: number;
}

function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

function getUsage(): DailyUsage {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const data = JSON.parse(stored) as DailyUsage;
      if (data.date === getToday()) {
        return {
          date: data.date,
          reads: data.reads || 0,
          writes: data.writes || 0,
          deletes: data.deletes || 0,
          geminiCalls: data.geminiCalls || 0
        };
      }
    }
  } catch { /* ignore corrupt data */ }
  return { date: getToday(), reads: 0, writes: 0, deletes: 0, geminiCalls: 0 };
}

function save(data: DailyUsage) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function trackReads(count: number = 1) {
  const u = getUsage();
  u.reads += count;
  save(u);
}

export function trackWrites(count: number = 1) {
  const u = getUsage();
  u.writes += count;
  save(u);
}

export function trackDeletes(count: number = 1) {
  const u = getUsage();
  u.deletes += count;
  save(u);
}

export function trackGeminiCall(count: number = 1) {
  const u = getUsage();
  u.geminiCalls += count;
  save(u);
}

export interface FirebaseUsageStats {
  date: string;
  reads: number;
  writes: number;
  deletes: number;
  geminiCalls: number;
  limits: {
    reads: number;
    writes: number;
    deletes: number;
    geminiCalls: number;
  };
}

export function getUsageStats(): FirebaseUsageStats {
  const usage = getUsage();
  return {
    ...usage,
    limits: {
      reads: 50000,   // Firestore free tier: 50K reads/day
      writes: 20000,  // Firestore free tier: 20K writes/day
      deletes: 20000, // Firestore free tier: 20K deletes/day
      geminiCalls: 1500 // Gemini Flash free tier: 1.5K requests/day (approx)
    }
  };
}

export function resetUsageStats() {
  localStorage.removeItem(STORAGE_KEY);
}