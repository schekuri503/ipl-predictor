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
  homeScore?: string;
  awayScore?: string;
  type: MatchType;
  odds?: {
    home: number;
    away: number;
  };
  homeVotes?: number;
  awayVotes?: number;
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

export interface Prediction {
  id: string; // userId_matchId
  userId: string;
  matchId: string;
  predictedWinner: string;
  timestamp: string;
}

export interface LeaderboardEntry extends UserProfile {
  rank?: number;
}
