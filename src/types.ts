export type MatchStatus = 'UPCOMING' | 'LIVE' | 'COMPLETED';
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
  summary?: string;
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
}

export interface LeaderboardEntry extends UserProfile {
  rank?: number;
}