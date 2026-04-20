export type MatchStatus = 'UPCOMING' | 'LIVE' | 'COMPLETED' | 'ABANDONED';
export type MatchType = 'REGULAR' | 'QUARTER_FINAL' | 'SEMI_FINAL' | 'FINAL';

export interface Match {
  id: string;
  homeTeam: string;
  awayTeam: string;
  date: string; // ISO string
  dateIST: string; // Indian format string
  venue: string;
  status: MatchStatus;
  winner?: string;
  tossWinner?: string;
  battingFirst?: string;
  homeScore?: string;
  awayScore?: string;
  type: MatchType;
  odds?: {
    home: number;
    away: number;
  };
  homeVotes?: number;
  awayVotes?: number;
  votes?: Record<string, number>;
  summary?: string;
  completedAt?: string; // ISO string
  winnerPoints?: number;
  totalLosers?: number;
  totalSkippersLosingPoints?: number;
  totalWinners?: number;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  photoURL: string;
  totalPoints: number;
  skipsUsed: number;
  email?: string;
  emailVerified?: boolean;
  role?: 'admin' | 'user';
  form?: ('W' | 'L' | 'S')[]; // Last 5 results: Win, Loss, Skip
  title?: string; // e.g., "The Oracle", "Skip King"
}

// Prediction types for dynamic winner resolution
// TOSS_WINNER: resolves to the team that won the toss
// BATTING_FIRST: resolves to the team that batted first
// BATTING_SECOND: resolves to the team that batted second (fielded first)
export type DynamicPrediction = 'TOSS_WINNER' | 'BATTING_FIRST' | 'BATTING_SECOND';

export interface Prediction {
  id: string; // userId_matchId
  userId: string;
  matchId: string;
  predictedWinner: string; // team code OR DynamicPrediction
  timestamp: string;
  optionsAvailable?: string[]; // History of what options the user had
  initialStatus?: MatchStatus; // Match status when prediction was made
  resolvedWinner?: string; // The actual team it resolved to
  pointsEarned?: number; // Points earned for this prediction
}

export interface LeaderboardEntry extends UserProfile {
  rank?: number;
}