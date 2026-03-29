/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { 
  onAuthStateChanged, 
  User 
} from 'firebase/auth';
import { 
  collection, 
  onSnapshot, 
  doc, 
  setDoc, 
  deleteDoc, 
  query, 
  orderBy, 
  updateDoc,
  getDocs,
  where,
  writeBatch,
  runTransaction,
  limit
} from 'firebase/firestore';
import { 
  Trophy, 
  User as UserIcon, 
  LogOut, 
  Calendar, 
  ChevronRight, 
  ChevronLeft,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Undo2,
  Settings,
  RefreshCw,
  MapPin,
  Clock,
  Coins,
  X,
  Trash2,
  ExternalLink,
  Save,
  Database,
  Activity,
  BarChart3,
  RotateCcw,
  Zap
} from 'lucide-react';
import { format, isAfter, parseISO, isToday } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { motion } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { auth, db, signInWithGoogle, logout } from './firebase';
import { Match, UserProfile, Prediction, MatchStatus, MatchType } from './types';
import { TEAMS, INITIAL_MATCHES, TOTAL_SKIPS_ALLOWED, APP_LOGO } from './constants';
import { fetchUpdatedSchedule, fetchOfficialResult, fetchLiveMatchData } from './services/geminiService';
import { trackReads, trackWrites, trackDeletes, getUsageStats, type FirebaseUsageStats } from './firebaseTracker';

// --- Error Handling ---

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  // We don't throw here to avoid crashing the app, but we log it.
  return errInfo;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-[#0F1115] text-center">
          <div className="widget-container p-8 max-w-md w-full">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Something went wrong</h2>
            <p className="text-gray-400 text-sm mb-6">
              {this.state.error?.message || "An unexpected error occurred."}
            </p>
            <button 
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-[#F27D26] text-white font-bold rounded-lg hover:bg-orange-600 transition-colors flex items-center gap-2 mx-auto"
            >
              <RefreshCw className="w-4 h-4" />
              Reload App
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Components ---

const MatchBadge = ({ status }: { status: MatchStatus }) => {
  const styles = {
    UPCOMING: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    LIVE: "bg-red-600 text-white border-red-600/30 is-live shadow-lg shadow-red-500/20",
    COMPLETED: "bg-gray-500/20 text-gray-400 border-gray-500/30"
  };

  return (
    <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider", styles[status])}>
      {status}
    </span>
  );
};

const TeamLogo = ({ teamCode, size = "md" }: { teamCode: string, size?: "sm" | "md" | "lg" }) => {
  const team = TEAMS[teamCode as keyof typeof TEAMS];
  const sizes = {
    sm: "w-8 h-8",
    md: "w-12 h-12",
    lg: "w-16 h-16"
  };
  
  return (
    <div className={cn("rounded-full flex items-center justify-center border-2 overflow-hidden bg-white/5", sizes[size])} style={{ borderColor: team?.color || '#fff' }}>
      <img src={team?.logo} alt={teamCode} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
    </div>
  );
};

// --- Main App ---

export default function App() {
  return (
    <ErrorBoundary>
      <PredictorApp />
    </ErrorBoundary>
  );
}

function PredictorApp() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'matches' | 'leaderboard'>('matches');
  const [matchFilter, setMatchFilter] = useState<'live-upcoming' | 'completed'>('live-upcoming');
  const [pendingPredictions, setPendingPredictions] = useState<Record<string, string>>({});
  const [savingPredictions, setSavingPredictions] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [recalculatingVotes, setRecalculatingVotes] = useState(false);
  const [selectedUserForAdmin, setSelectedUserForAdmin] = useState<UserProfile | null>(null);
  const [adminPredictions, setAdminPredictions] = useState<Prediction[]>([]);
  const [loadingAdminPredictions, setLoadingAdminPredictions] = useState(false);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  };
  const [syncingSchedule, setSyncingSchedule] = useState(false);
  const [showVoters, setShowVoters] = useState<{ matchId: string, teamCode: string } | null>(null);
  const [voters, setVoters] = useState<UserProfile[]>([]);
  const [loadingVoters, setLoadingVoters] = useState(false);
  const [editingMatch, setEditingMatch] = useState<Match | null>(null);
  const [userToDelete, setUserToDelete] = useState<UserProfile | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [liveVoteCounts, setLiveVoteCounts] = useState<Record<string, Record<string, number>>>({});
  const [pendingToss, setPendingToss] = useState<Record<string, { tossWinner?: string; battingChoice?: 'BAT' | 'BOWL' }>>({});
  const [firebaseUsage, setFirebaseUsage] = useState<FirebaseUsageStats>(getUsageStats());
  const [autoUpdating, setAutoUpdating] = useState(false);
  const lastFetchRef = useRef<Record<string, number>>({});
  const [tick, setTick] = useState(0); // triggers re-render for effective match status

  const isAdminUser = profile?.role === 'admin' || user?.email === 's.chaitanya.503@gmail.com';

  // Compute effective match status based on current time (client-side, no Firebase reads)
  const getEffectiveStatus = useCallback((match: Match): MatchStatus => {
    if (match.status === 'COMPLETED') return 'COMPLETED';
    const now = new Date();
    const matchDate = parseISO(match.date);
    if (isAfter(now, matchDate)) return 'LIVE';
    return match.status;
  }, []);

  const refreshUsageStats = useCallback(() => {
    setFirebaseUsage(getUsageStats());
  }, []);

  // Fetch matches on demand with caching to reduce Firebase reads
  // forceRefresh bypasses cache (used by manual refresh button)
  const fetchMatches = async (forceRefresh = false): Promise<Match[]> => {
    if (!user) return [];

    // Cache: skip Firestore fetch if recent enough
    const cacheKey = matchFilter;
    const lastFetch = lastFetchRef.current[cacheKey] || 0;
    const maxAge = matchFilter === 'completed' ? 24 * 60 * 60 * 1000 : 5 * 60 * 1000; // 24h for completed, 5min for live/upcoming

    if (!forceRefresh && (Date.now() - lastFetch) < maxAge) {
      const statusFilter = matchFilter === 'completed' ? ['COMPLETED'] : ['UPCOMING', 'LIVE'];
      const cached = matches.filter(m => statusFilter.includes(m.status));
      if (cached.length > 0) return cached;
    }

    try {
      const statusFilter = matchFilter === 'completed' ? ['COMPLETED'] : ['UPCOMING', 'LIVE'];
      const q = query(
        collection(db, 'matches'),
        where('status', 'in', statusFilter),
        orderBy('date', matchFilter === 'completed' ? 'desc' : 'asc'),
        limit(matchFilter === 'completed' ? 40 : 30)
      );
      const snap = await getDocs(q);
      trackReads(snap.docs.length || 1);
      const matchData = snap.docs.map(d => ({
        ...d.data(),
        homeVotes: d.data().homeVotes || 0,
        awayVotes: d.data().awayVotes || 0
      } as Match));

      setMatches(prev => {
        const otherMatches = prev.filter(m => !statusFilter.includes(m.status));
        const combined = [...otherMatches, ...matchData];
        const unique = Array.from(new Map(combined.map(m => [m.id, m])).values());
        return unique.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      });

      lastFetchRef.current[cacheKey] = Date.now();
      refreshUsageStats();
      return matchData;
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'matches');
      return [];
    }
  };

  // Fetch user predictions on demand (called on login + manual refresh)
  const fetchUserPredictions = async () => {
    if (!user) return;
    try {
      const snap = await getDocs(query(collection(db, 'predictions'), where('userId', '==', user.uid)));
      trackReads(snap.docs.length || 1);
      setPredictions(snap.docs.map(d => d.data() as Prediction));
      refreshUsageStats();
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'predictions');
    }
  };

  // Fetch vote counts from predictions collection (source of truth)
  const fetchVoteCounts = async (matchList?: Match[]) => {
    const targetMatches = matchList || matches;
    if (targetMatches.length === 0) return;
    try {
      const matchIds = targetMatches.map(m => m.id);
      const counts: Record<string, Record<string, number>> = {};

      // Firestore 'in' queries support up to 30 items
      for (let i = 0; i < matchIds.length; i += 30) {
        const chunk = matchIds.slice(i, i + 30);
        const q = query(
          collection(db, 'predictions'),
          where('matchId', 'in', chunk)
        );
        const snap = await getDocs(q);
        trackReads(snap.docs.length || 1);
        snap.docs.forEach(d => {
          const pred = d.data() as Prediction;
          if (!counts[pred.matchId]) counts[pred.matchId] = {};
          counts[pred.matchId][pred.predictedWinner] = (counts[pred.matchId][pred.predictedWinner] || 0) + 1;
        });
      }

      setLiveVoteCounts(counts);
      refreshUsageStats();
    } catch (error) {
      console.error('Error fetching vote counts:', error);
    }
  };

  // Fetch leaderboard on demand
  const fetchLeaderboard = async () => {
    if (!user) return;
    try {
      const snap = await getDocs(query(collection(db, 'users'), orderBy('totalPoints', 'desc'), limit(50)));
      trackReads(snap.docs.length || 1);
      setUsers(snap.docs.map(d => d.data() as UserProfile));
      refreshUsageStats();
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'users');
    }
  };

  // Refresh everything - called when user hits refresh button
  const handleRefresh = async () => {
    setIsRefreshing(true);
    const [freshMatches] = await Promise.all([fetchMatches(true), fetchUserPredictions()]);
    await fetchVoteCounts(freshMatches);
    if (activeTab === 'leaderboard') await fetchLeaderboard();
    refreshUsageStats();
    setIsRefreshing(false);
  };

  // 1. Auth Listener
  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (!u) {
        setLoading(false);
        setProfile(null);
        setMatches([]);
        setUsers([]);
        setPredictions([]);
      }
    });
    return () => unsubAuth();
  }, []);

  // 2. Fetch matches + vote counts on login and when filter changes
  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const freshMatches = await fetchMatches();
      await fetchVoteCounts(freshMatches);
      if (loading) setLoading(false);
    };
    load();
  }, [user, matchFilter]);

  // 3. User Profile (real-time for points updates) & Predictions (one-time fetch on login)
  useEffect(() => {
    if (!user) return;

    // Profile uses onSnapshot since it's a single doc and needs live point updates
    const unsubProfile = onSnapshot(doc(db, 'users', user.uid), (snap) => {
      if (snap.exists()) {
        setProfile(snap.data() as UserProfile);
      } else {
        const newProfile: UserProfile = {
          uid: user.uid,
          displayName: user.displayName || 'Anonymous User',
          photoURL: user.photoURL || '',
          totalPoints: 0,
          skipsUsed: 0,
          role: 'user',
          email: user.email || ''
        };
        setDoc(doc(db, 'users', user.uid), newProfile).catch(e => handleFirestoreError(e, OperationType.CREATE, `users/${user.uid}`));
        setProfile(newProfile);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
    });

    // Fetch predictions once on login
    fetchUserPredictions();

    return () => unsubProfile();
  }, [user]);

  // Lazy load leaderboard (one-time fetch when tab is first opened)
  useEffect(() => {
    if (activeTab === 'leaderboard' && users.length === 0) {
      fetchLeaderboard();
    }
  }, [activeTab]);

  // Completed matches are loaded via effect #2 which re-runs when matchFilter changes

  // Fetch predictions for selected user (Admin only)
  useEffect(() => {
    if (!isAdminUser || !selectedUserForAdmin) {
      setAdminPredictions([]);
      return;
    }

    const fetchAdminPredictions = async () => {
      setLoadingAdminPredictions(true);
      try {
        const snap = await getDocs(query(collection(db, 'predictions'), where('userId', '==', selectedUserForAdmin.uid)));
        setAdminPredictions(snap.docs.map(doc => doc.data() as Prediction));
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, 'admin-predictions');
      } finally {
        setLoadingAdminPredictions(false);
      }
    };

    fetchAdminPredictions();
  }, [isAdminUser, selectedUserForAdmin]);

  // Fetch voters for a specific match/team on demand
  useEffect(() => {
    const fetchVoters = async () => {
      if (!showVoters) {
        setVoters([]);
        return;
      }
      
      setLoadingVoters(true);
      try {
        const q = query(
          collection(db, 'predictions'),
          where('matchId', '==', showVoters.matchId),
          where('predictedWinner', '==', showVoters.teamCode),
          limit(50)
        );
        const snap = await getDocs(q);
        const userIds = snap.docs.map(doc => doc.data().userId);
        
        if (userIds.length === 0) {
          setVoters([]);
          return;
        }

        // Fetch user profiles for these IDs in chunks of 10 (Firestore 'in' limit)
        const profiles: UserProfile[] = [];
        for (let i = 0; i < userIds.length; i += 10) {
          const chunk = userIds.slice(i, i + 10);
          const userSnap = await getDocs(query(collection(db, 'users'), where('uid', 'in', chunk)));
          profiles.push(...userSnap.docs.map(d => d.data() as UserProfile));
        }
        setVoters(profiles);
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, 'voters');
      } finally {
        setLoadingVoters(false);
      }
    };

    fetchVoters();
  }, [showVoters]);

  // Re-render every 2 minutes to update effective match statuses (UPCOMING→LIVE based on time)
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 120000);
    return () => clearInterval(interval);
  }, []);

  // Refresh firebase usage stats periodically
  useEffect(() => {
    refreshUsageStats();
    const interval = setInterval(refreshUsageStats, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleSyncSchedule = async () => {
    if (!isAdminUser) return;
    setSyncingSchedule(true);
    try {
      const newSchedule = await fetchUpdatedSchedule();
      if (newSchedule && Array.isArray(newSchedule)) {
        const batch = writeBatch(db);
        newSchedule.forEach((m: any) => {
          const matchRef = doc(db, 'matches', m.id);
          batch.set(matchRef, {
            ...m,
            status: m.status || 'UPCOMING'
          }, { merge: true });
        });
        await batch.commit();
        trackWrites(newSchedule.length);
        await fetchMatches(true);
        refreshUsageStats();
      }
    } catch (error) {
      console.error("Error syncing schedule", error);
      showToast("Failed to sync schedule. Please try again.", "error");
    }
    setSyncingSchedule(false);
  };

  const handlePredict = (matchId: string, team: string) => {
    if (!user) return;
    const match = matches.find(m => m.id === matchId);
    if (!match) return;

    // Check if match has started (Admins can bypass)
    const isLocked = isAfter(new Date(), parseISO(match.date)) || match.status !== 'UPCOMING';
    if (isLocked && !isAdminUser) {
      alert("Match has already started or completed. Predictions are locked.");
      return;
    }

    const currentPredictions = selectedUserForAdmin ? adminPredictions : predictions;
    const savedPrediction = currentPredictions.find(p => p.matchId === matchId);
    const currentPending = pendingPredictions[matchId];
    
    setPendingPredictions(prev => {
      const next = { ...prev };
      
      // If clicking the same team that is currently pending, clear it
      if (currentPending === team) {
        delete next[matchId];
      } 
      // If clicking the same team that is already saved (and no pending), clear it (undo)
      else if (!currentPending && savedPrediction?.predictedWinner === team) {
        next[matchId] = ''; // Use empty string to indicate "no prediction" (undoing saved)
      }
      // Otherwise set the new team
      else {
        next[matchId] = team;
      }
      return next;
    });
  };

  const handleUndo = (matchId: string) => {
    if (!user) return;

    setPendingPredictions(prev => {
      const next = { ...prev };
      delete next[matchId];
      return next;
    });
    setPendingToss(prev => {
      const next = { ...prev };
      delete next[matchId];
      return next;
    });
  };

  const handleClearSelection = (matchId: string) => {
    if (!user) return;

    setPendingPredictions(prev => ({
      ...prev,
      [matchId]: '' // Empty string means "clear prediction"
    }));
    // Also clear toss predictions
    setPendingToss(prev => {
      const next = { ...prev };
      delete next[matchId];
      return next;
    });
  };

  const handleTossPrediction = (matchId: string, field: 'tossWinner' | 'battingChoice', value: string) => {
    if (!user) return;
    const match = matches.find(m => m.id === matchId);
    if (!match) return;

    const isLocked = isAfter(new Date(), parseISO(match.date)) || match.status !== 'UPCOMING';
    if (isLocked && !isAdminUser) return;

    setPendingToss(prev => {
      const existing = prev[matchId] || {};
      const currentVal = existing[field];

      // Toggle off if same value clicked
      if (currentVal === value) {
        const next = { ...prev, [matchId]: { ...existing } };
        delete next[matchId][field];
        if (Object.keys(next[matchId]).length === 0) delete next[matchId];
        return next;
      }

      return {
        ...prev,
        [matchId]: { ...existing, [field]: value }
      };
    });
  };

  const saveAllPredictions = async () => {
    const hasPendingWinner = Object.keys(pendingPredictions).length > 0;
    const hasPendingToss = Object.keys(pendingToss).length > 0;
    if (!user || (!hasPendingWinner && !hasPendingToss)) return;

    const targetUserId = selectedUserForAdmin?.uid || user.uid;
    setSavingPredictions(true);
    try {
      // Collect all match IDs that need saving (winner or toss)
      const allMatchIds = new Set([
        ...Object.keys(pendingPredictions),
        ...Object.keys(pendingToss)
      ]);

      await runTransaction(db, async (transaction) => {
        for (const matchId of allMatchIds) {
          const predictionId = `${targetUserId}_${matchId}`;
          const predictionRef = doc(db, 'predictions', predictionId);
          const team = pendingPredictions[matchId];
          const toss = pendingToss[matchId];

          if (team === '') {
            transaction.delete(predictionRef);
          } else {
            const predData: Record<string, any> = {
              id: predictionId,
              userId: targetUserId,
              matchId,
              timestamp: new Date().toISOString()
            };
            // Include winner prediction if set
            if (team !== undefined) {
              predData.predictedWinner = team;
            }
            // Include toss predictions if set
            if (toss?.tossWinner) {
              predData.tossWinner = toss.tossWinner;
            }
            if (toss?.battingChoice) {
              predData.battingChoice = toss.battingChoice;
            }
            transaction.set(predictionRef, predData, { merge: true });
          }
        }
      });
      
      // Track writes/deletes
      const writeCount = Object.values(pendingPredictions).filter(t => t !== '').length;
      const deleteCount = Object.values(pendingPredictions).filter(t => t === '').length;
      if (writeCount > 0) trackWrites(writeCount);
      if (deleteCount > 0) trackDeletes(deleteCount);

      setPendingPredictions({});
      setPendingToss({});
      if (selectedUserForAdmin) {
        const snap = await getDocs(query(collection(db, 'predictions'), where('userId', '==', selectedUserForAdmin.uid)));
        trackReads(snap.docs.length || 1);
        setAdminPredictions(snap.docs.map(d => d.data() as Prediction));
      } else {
        await fetchUserPredictions();
      }
      // Skip refetching matches (they don't change on prediction save) - just refresh vote counts
      await fetchVoteCounts();
      refreshUsageStats();
      showToast(`Predictions saved for ${selectedUserForAdmin ? selectedUserForAdmin.displayName : 'you'}!`);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'batch-predictions');
    } finally {
      setSavingPredictions(false);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!isAdminUser) return;
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'users', userId));
      const predsSnap = await getDocs(query(collection(db, 'predictions'), where('userId', '==', userId)));
      trackReads(predsSnap.docs.length || 1);
      predsSnap.forEach(p => batch.delete(p.ref));
      await batch.commit();
      trackDeletes(1 + predsSnap.docs.length);
      refreshUsageStats();
      setUserToDelete(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${userId}`);
    }
  };

  const handleUpdateMatch = async (matchId: string, updates: Partial<Match>) => {
    if (!isAdminUser) return;
    try {
      await updateDoc(doc(db, 'matches', matchId), updates);
      trackWrites(1);
      setEditingMatch(null);
      await fetchMatches(true);
      refreshUsageStats();
      showToast("Match updated successfully!");
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `matches/${matchId}`);
    }
  };

  const handleRecalculateVotes = async () => {
    if (!isAdminUser) return;
    setRecalculatingVotes(true);
    try {
      // Fetch ALL matches to ensure we update everything
      const allMatchesSnap = await getDocs(collection(db, 'matches'));
      trackReads(allMatchesSnap.docs.length || 1);
      const allMatches = allMatchesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Match));

      const allPredsSnap = await getDocs(collection(db, 'predictions'));
      trackReads(allPredsSnap.docs.length || 1);
      const allPreds = allPredsSnap.docs.map(doc => doc.data() as Prediction);
      
      const counts: Record<string, { home: number, away: number }> = {};
      
      // Initialize counts for all matches
      allMatches.forEach(m => {
        counts[m.id] = { home: 0, away: 0 };
      });
      
      // Count votes
      allPreds.forEach(p => {
        if (!counts[p.matchId]) counts[p.matchId] = { home: 0, away: 0 };
        const match = allMatches.find(m => m.id === p.matchId);
        if (match) {
          if (p.predictedWinner === match.homeTeam) counts[p.matchId].home++;
          else if (p.predictedWinner === match.awayTeam) counts[p.matchId].away++;
        }
      });
      
      const batch = writeBatch(db);
      Object.entries(counts).forEach(([matchId, voteData]) => {
        batch.update(doc(db, 'matches', matchId), {
          homeVotes: voteData.home,
          awayVotes: voteData.away
        });
      });
      
      await batch.commit();
      trackWrites(Object.keys(counts).length);
      const freshMatches = await fetchMatches(true);
      await fetchVoteCounts(freshMatches);
      refreshUsageStats();
      showToast("Vote counts recalculated successfully!");
    } catch (error) {
      console.error("Error recalculating votes", error);
      showToast("Failed to recalculate votes.", "error");
    } finally {
      setRecalculatingVotes(false);
    }
  };

  // Admin: Complete Match & Calculate Points
  const handleCompleteMatch = async (match: Match, winner: string) => {
    if (!isAdminUser) return;
    const batch = writeBatch(db);
    
    // 1. Update Match
    batch.update(doc(db, 'matches', match.id), {
      status: 'COMPLETED',
      winner,
      homeScore: match.homeScore || null,
      awayScore: match.awayScore || null
    });

    // 2. Get all predictions for this match
    const predsSnap = await getDocs(query(collection(db, 'predictions'), where('matchId', '==', match.id)));
    trackReads(predsSnap.docs.length || 1);
    const matchPredictions = predsSnap.docs.map(d => d.data() as Prediction);
    
    const winners = matchPredictions.filter(p => p.predictedWinner === winner);
    const losers = matchPredictions.filter(p => p.predictedWinner !== winner);
    
    // Point Multiplier
    let multiplier = 1;
    if (match.type === 'QUARTER_FINAL' || match.type === 'SEMI_FINAL') multiplier = 2;
    if (match.type === 'FINAL') multiplier = 4;

    // Calculate points
    // if anyone losses they will get -1, if anyone wins total lossers/ total winners
    const totalLosers = losers.length;
    const totalWinners = winners.length;
    
    const winnerPoints = totalWinners > 0 ? (totalLosers / totalWinners) : 0;
    const loserPoints = -1;

    // Update User Points
    // We also need to handle "skips"
    // Find all users who didn't predict
    const allUsersSnap = await getDocs(collection(db, 'users'));
    trackReads(allUsersSnap.docs.length || 1);
    const allUserProfiles = allUsersSnap.docs.map(d => d.data() as UserProfile);
    
    for (const u of allUserProfiles) {
      const userPred = matchPredictions.find(p => p.userId === u.uid);
      let pointChange = 0;
      let skipChange = 0;

      if (userPred) {
        pointChange = userPred.predictedWinner === winner ? winnerPoints : loserPoints;
      } else {
        // Did not predict
        if (match.type === 'FINAL') {
          pointChange = -1; // Cannot skip finals
        } else if (u.skipsUsed < TOTAL_SKIPS_ALLOWED) {
          skipChange = 1;
          // If it's QF/SF, can only skip one match if they have left over
          // This logic is a bit complex for a simple batch, but let's assume they use a skip if available
          pointChange = 0;
        } else {
          pointChange = -1; // No skips left
        }
      }

      batch.update(doc(db, 'users', u.uid), {
        totalPoints: (u.totalPoints || 0) + (pointChange * multiplier),
        skipsUsed: (u.skipsUsed || 0) + skipChange
      });
    }

    await batch.commit();
    trackWrites(1 + allUserProfiles.length); // 1 match + all user updates
    refreshUsageStats();
  };

  // Admin: Auto-update match statuses (UPCOMING→LIVE, LIVE→COMPLETED with results from web)
  const handleAutoUpdateMatches = async () => {
    if (!isAdminUser) return;
    setAutoUpdating(true);
    try {
      const now = new Date();
      const statusBatch = writeBatch(db);
      let statusUpdates = 0;
      const matchesToComplete: Match[] = [];

      for (const match of matches) {
        const matchDate = parseISO(match.date);

        // UPCOMING → LIVE: if match start time has passed
        if (match.status === 'UPCOMING' && isAfter(now, matchDate)) {
          statusBatch.update(doc(db, 'matches', match.id), { status: 'LIVE' as MatchStatus });
          statusUpdates++;
        }

        // LIVE → try to complete: if 4+ hours since match start
        if (match.status === 'LIVE' || (match.status === 'UPCOMING' && isAfter(now, matchDate))) {
          const hoursElapsed = (now.getTime() - matchDate.getTime()) / (1000 * 60 * 60);
          if (hoursElapsed >= 4) {
            matchesToComplete.push(match);
          }
        }
      }

      // Batch update UPCOMING → LIVE
      if (statusUpdates > 0) {
        await statusBatch.commit();
        trackWrites(statusUpdates);
      }

      // Try to fetch results and complete eligible matches
      let completedCount = 0;
      for (const match of matchesToComplete) {
        try {
          showToast(`Fetching result for ${match.homeTeam} vs ${match.awayTeam}...`);
          const result = await fetchOfficialResult(match);
          if (result?.winner && result.status === 'COMPLETED' &&
              result.winner !== 'DRAW' && result.winner !== 'ABANDONED') {
            const updatedMatch = {
              ...match,
              homeScore: result.homeScore || match.homeScore,
              awayScore: result.awayScore || match.awayScore
            };
            await handleCompleteMatch(updatedMatch, result.winner);
            completedCount++;
          } else if (result?.homeScore || result?.awayScore) {
            // Update scores even if not completed yet
            await handleUpdateMatch(match.id, {
              homeScore: result.homeScore || match.homeScore,
              awayScore: result.awayScore || match.awayScore
            });
          }
        } catch (e) {
          console.error(`Failed to fetch result for ${match.id}:`, e);
        }
      }

      await fetchMatches(true);
      refreshUsageStats();
      showToast(`Auto-update: ${statusUpdates} → LIVE, ${completedCount} completed`);
    } catch (error) {
      console.error("Error auto-updating matches:", error);
      showToast("Failed to auto-update matches", "error");
    } finally {
      setAutoUpdating(false);
    }
  };

  // Admin: Reset skip count for a user
  const handleResetSkips = async (userId: string, userName?: string) => {
    if (!isAdminUser) return;
    try {
      await updateDoc(doc(db, 'users', userId), { skipsUsed: 0 });
      trackWrites(1);
      refreshUsageStats();
      showToast(`Skip count reset to 0 for ${userName || 'user'}!`);
      // Refresh leaderboard to show updated data
      if (activeTab === 'leaderboard') await fetchLeaderboard();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${userId}`);
      showToast("Failed to reset skips", "error");
    }
  };

  const handleSignIn = async () => {
    setIsSigningIn(true);
    setSignInError(null);
    try {
      await signInWithGoogle();
    } catch (error: any) {
      console.error("Sign-in failed:", error);
      if (error?.code === 'auth/configuration-not-found') {
        setSignInError("Google Sign-In is not enabled in your Firebase Console. Please enable it in Authentication > Sign-in method.");
      } else if (error?.code === 'auth/unauthorized-domain') {
        setSignInError("This domain is not authorized in your Firebase Console. Please add this domain to Authentication > Settings > Authorized domains.");
      } else {
        setSignInError(error?.message || "Failed to sign in. Please try again.");
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0F1115]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-[#F27D26] border-t-transparent rounded-full animate-spin"></div>
          <p className="status-label">Initializing Predictor...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[#0F1115]">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="widget-container p-8 max-w-md w-full text-center"
        >
          <div className="mb-8 flex justify-center">
            <div className="relative group">
              <div className="absolute -inset-6 bg-gradient-to-r from-[#F27D26]/30 via-blue-500/20 to-[#FFD700]/30 blur-3xl rounded-full opacity-60 group-hover:opacity-100 transition-opacity duration-1000 animate-pulse" />
              <div className="w-40 h-40 flex items-center justify-center bg-[#1A1D23] rounded-[2.5rem] border border-white/10 shadow-[0_0_50px_rgba(242,125,38,0.3)] relative z-10 p-3 overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-black/20" />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(242,125,38,0.1)_0%,transparent_70%)]" />
                <img
                  src={APP_LOGO}
                  alt="IPL ADDA Logo"
                  className="w-full h-full object-contain drop-shadow-[0_0_25px_rgba(242,125,38,0.6)] relative z-10 transform group-hover:scale-110 transition-transform duration-700"
                  referrerPolicy="no-referrer"
                />
              </div>
            </div>
          </div>
          <h1 className="text-5xl font-black mb-3 ipl-text-gradient tracking-tighter drop-shadow-[0_4px_10px_rgba(0,0,0,0.5)]">కాయ్ రాజా కాయ్</h1>
          <p className="text-gray-400 mb-6 text-sm leading-relaxed">Join your friends and predict the winners of IPL 2026.<br />A fan-made project for friendly competition.</p>
          
          <div className="mb-8 p-4 bg-white/5 rounded-xl text-xs text-gray-400 text-left space-y-2 border border-white/10">
            <p className="font-bold text-gray-300 uppercase tracking-wider text-[10px]">About this project</p>
            <p>This is a non-commercial, fan-made application created for educational and entertainment purposes. We use Google Sign-In to securely identify you for the leaderboard.</p>
            <p className="text-[10px] italic">Note: We only store your public name and profile picture. We never see your password.</p>
          </div>
          
          {signInError && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm text-left flex gap-3">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <p>{signInError}</p>
            </div>
          )}

          <button 
            onClick={handleSignIn}
            disabled={isSigningIn}
            className="w-full py-4 px-6 bg-white text-black font-bold rounded-xl flex items-center justify-center gap-3 hover:bg-gray-100 transition-colors disabled:opacity-50"
          >
            {isSigningIn ? (
              <RefreshCw className="w-5 h-5 animate-spin" />
            ) : (
              <img src="https://www.google.com/favicon.ico" alt="Google" className="w-5 h-5" />
            )}
            {isSigningIn ? 'Signing in...' : 'Sign in with Google'}
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24">
      {/* Toast Notification */}
      {toast && (
        <div className={cn(
          "fixed bottom-4 right-4 z-50 p-4 rounded-lg shadow-lg max-w-md animate-in fade-in slide-in-from-bottom-4",
          toast.type === 'success' ? "bg-green-600 text-white" : "bg-red-600 text-white"
        )}>
          <div className="flex items-center gap-3">
            <div className="flex-1 text-sm font-medium">{toast.message}</div>
            <button onClick={() => setToast(null)} className="text-white/60 hover:text-white">
              <LogOut className="w-4 h-4 rotate-90" />
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#0F1115]/80 backdrop-blur-md border-b border-white/5 px-4 py-4">
        <div className="max-w-4xl mx-auto flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="relative group">
                <div className="absolute -inset-2 bg-gradient-to-r from-[#F27D26]/30 to-blue-500/20 blur-xl rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <div className="w-16 h-16 flex items-center justify-center bg-[#1A1D23] rounded-2xl border border-white/10 shadow-2xl relative z-10 p-1 overflow-hidden ring-1 ring-white/5">
                  <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent" />
                  <img
                    src={APP_LOGO}
                    alt="IPL ADDA Logo"
                    className="w-full h-full object-contain drop-shadow-[0_0_12px_rgba(242,125,38,0.5)] transform group-hover:scale-105 transition-transform duration-500"
                    referrerPolicy="no-referrer"
                  />
                </div>
              </div>
              <div>
                <h1 className="text-2xl font-black tracking-tighter ipl-text-gradient leading-none mb-1">కాయ్ రాజా కాయ్</h1>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 bg-red-500/10 px-2 py-0.5 rounded-full border border-red-500/20">
                    <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                    <span className="text-[9px] font-black tracking-widest text-red-400 uppercase">IPL 2026 LIVE</span>
                  </div>
                  {profile && (
                    <span className="text-[10px] text-[#F27D26] font-black uppercase tracking-tighter flex items-center gap-1">
                      <Coins className="w-3 h-3" />
                      {TOTAL_SKIPS_ALLOWED - (profile.skipsUsed || 0)} Skips Left
                    </span>
                  )}
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <button 
                onClick={() => handleRefresh()}
                disabled={isRefreshing}
                className={cn(
                  "p-2 rounded-lg bg-white/5 text-gray-400 hover:text-white transition-all group",
                  isRefreshing && "animate-spin text-[#F27D26]"
                )}
                title="Refresh Matches"
              >
                <RefreshCw className="w-5 h-5 group-hover:rotate-180 transition-transform duration-500" />
              </button>
              {isAdminUser && (
                <button 
                  onClick={() => setShowAdmin(!showAdmin)}
                  className={cn("p-2 rounded-lg transition-colors", showAdmin ? "bg-[#F27D26] text-white" : "bg-white/5 text-gray-400 hover:bg-white/10")}
                  title="Admin Settings"
                >
                  <Settings className="w-5 h-5" />
                </button>
              )}
              <div className="flex items-center gap-2 bg-white/5 rounded-full pl-1 pr-3 py-1 border border-white/10">
                {user.photoURL ? (
                  <img src={user.photoURL} alt="" className="w-7 h-7 rounded-full border border-white/20" />
                ) : (
                  <div className="w-7 h-7 rounded-full border border-white/20 bg-white/10 flex items-center justify-center">
                    <UserIcon className="w-4 h-4 text-gray-400" />
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <Trophy className="w-3 h-3 text-[#FFD700]" />
                  <span className="text-sm font-black tracking-tight">{profile?.totalPoints || 0} PTS</span>
                </div>
              </div>
              <button onClick={logout} className="p-2 text-gray-400 hover:text-red-500 transition-colors">
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>

          {isAdminUser && showAdmin && (
            <div className="space-y-3">
              {/* Admin Action Buttons */}
              <div className="flex flex-wrap items-center gap-2 p-2 bg-white/5 rounded-xl border border-white/10">
                <a
                  href="https://console.firebase.google.com/project/gen-lang-client-0471952212/firestore/databases/ai-studio-36e88d64-d641-4011-8fda-fbfe027be7a7/data"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#F27D26]/10 text-[#F27D26] text-xs font-bold hover:bg-[#F27D26]/20 transition-colors"
                >
                  <Database className="w-3 h-3" />
                  Database
                </a>
                <button
                  onClick={handleSyncSchedule}
                  disabled={syncingSchedule}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 text-xs font-bold hover:bg-indigo-500/20 transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={cn("w-3 h-3", syncingSchedule && "animate-spin")} />
                  Sync Schedule
                </button>
                <button
                  onClick={handleRecalculateVotes}
                  disabled={recalculatingVotes}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-yellow-500/10 text-yellow-500 text-xs font-bold hover:bg-yellow-500/20 transition-colors disabled:opacity-50"
                >
                  <Database className={cn("w-3 h-3", recalculatingVotes && "animate-spin")} />
                  Recalculate Votes
                </button>
                <button
                  onClick={handleAutoUpdateMatches}
                  disabled={autoUpdating}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-green-500/10 text-green-400 text-xs font-bold hover:bg-green-500/20 transition-colors disabled:opacity-50"
                >
                  <Zap className={cn("w-3 h-3", autoUpdating && "animate-spin")} />
                  {autoUpdating ? 'Updating...' : 'Auto-Update Matches'}
                </button>
                {profile && (profile.skipsUsed || 0) > 0 && (
                  <button
                    onClick={() => handleResetSkips(user!.uid, 'yourself')}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-500/10 text-purple-400 text-xs font-bold hover:bg-purple-500/20 transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Reset My Skips ({profile.skipsUsed})
                  </button>
                )}
              </div>

              {/* Firebase Usage Dashboard */}
              <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                <div className="flex items-center gap-2 mb-3">
                  <Activity className="w-3.5 h-3.5 text-[#F27D26]" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                    Firebase Usage Today ({firebaseUsage.date})
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {/* Reads */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-bold uppercase text-blue-400">Reads</span>
                      <span className="text-[9px] font-mono text-gray-500">
                        {firebaseUsage.reads.toLocaleString()} / {firebaseUsage.limits.reads.toLocaleString()}
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min((firebaseUsage.reads / firebaseUsage.limits.reads) * 100, 100)}%` }}
                      />
                    </div>
                    <span className="text-[8px] text-gray-600">
                      {((firebaseUsage.reads / firebaseUsage.limits.reads) * 100).toFixed(1)}% used
                    </span>
                  </div>
                  {/* Writes */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-bold uppercase text-green-400">Writes</span>
                      <span className="text-[9px] font-mono text-gray-500">
                        {firebaseUsage.writes.toLocaleString()} / {firebaseUsage.limits.writes.toLocaleString()}
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-green-500 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min((firebaseUsage.writes / firebaseUsage.limits.writes) * 100, 100)}%` }}
                      />
                    </div>
                    <span className="text-[8px] text-gray-600">
                      {((firebaseUsage.writes / firebaseUsage.limits.writes) * 100).toFixed(1)}% used
                    </span>
                  </div>
                  {/* Deletes */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-bold uppercase text-red-400">Deletes</span>
                      <span className="text-[9px] font-mono text-gray-500">
                        {firebaseUsage.deletes.toLocaleString()} / {firebaseUsage.limits.deletes.toLocaleString()}
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-red-500 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min((firebaseUsage.deletes / firebaseUsage.limits.deletes) * 100, 100)}%` }}
                      />
                    </div>
                    <span className="text-[8px] text-gray-600">
                      {((firebaseUsage.deletes / firebaseUsage.limits.deletes) * 100).toFixed(1)}% used
                    </span>
                  </div>
                </div>
                <div className="mt-2 pt-2 border-t border-white/5 flex items-center justify-between">
                  <span className="text-[8px] text-gray-600 uppercase">
                    Free Tier: 50K reads, 20K writes, 20K deletes / day
                  </span>
                  <span className="text-[8px] text-gray-600">
                    {firebaseUsage.limits.reads - firebaseUsage.reads > 0
                      ? `${(firebaseUsage.limits.reads - firebaseUsage.reads).toLocaleString()} reads remaining`
                      : 'Reads limit reached!'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4">
        {activeTab === 'matches' ? (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-2">
              <div className="flex items-center justify-between w-full sm:w-auto">
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-[#F27D26]" />
                  Match Schedule
                </h2>
                <button 
                  onClick={() => handleRefresh()}
                  disabled={isRefreshing}
                  className={cn(
                    "sm:hidden p-2 rounded-lg bg-white/5 text-gray-400 hover:text-white transition-all",
                    isRefreshing && "animate-spin text-[#F27D26]"
                  )}
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => handleRefresh()}
                  disabled={isRefreshing}
                  className={cn(
                    "hidden sm:flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 text-gray-400 hover:text-white transition-all border border-white/10",
                    isRefreshing && "text-[#F27D26]"
                  )}
                >
                  <RefreshCw className={cn("w-4 h-4", isRefreshing && "animate-spin")} />
                  <span className="text-xs font-bold">{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
                </button>
                <div className="flex bg-white/5 p-1 rounded-xl border border-white/10 flex-1 sm:flex-none">
                  <button
                    onClick={() => setMatchFilter('live-upcoming')}
                    className={cn(
                      "flex-1 sm:flex-none px-4 py-2 rounded-lg text-xs font-bold transition-all",
                      matchFilter === 'live-upcoming' ? "bg-[#F27D26] text-white shadow-lg shadow-orange-500/20" : "text-gray-400 hover:text-white"
                    )}
                  >
                    Live & Upcoming
                  </button>
                  <button
                    onClick={() => setMatchFilter('completed')}
                    className={cn(
                      "flex-1 sm:flex-none px-4 py-2 rounded-lg text-xs font-bold transition-all",
                      matchFilter === 'completed' ? "bg-[#F27D26] text-white shadow-lg shadow-orange-500/20" : "text-gray-400 hover:text-white"
                    )}
                  >
                    Completed
                  </button>
                </div>
              </div>
            </div>

            <div className="grid gap-4">
              {matches.filter(m => matchFilter === 'completed' ? m.status === 'COMPLETED' : m.status !== 'COMPLETED').length === 0 ? (
                <div className="widget-container p-12 text-center">
                  <Calendar className="w-12 h-12 text-gray-600 mx-auto mb-4 opacity-20" />
                  <p className="text-gray-500 font-bold">No {matchFilter === 'completed' ? 'completed' : 'upcoming'} matches found.</p>
                  <button 
                    onClick={() => handleRefresh()}
                    className="mt-4 text-[#F27D26] text-xs font-bold hover:underline"
                  >
                    Try refreshing
                  </button>
                </div>
              ) : matches
                .filter(m => matchFilter === 'completed' ? m.status === 'COMPLETED' : m.status !== 'COMPLETED')
                .sort((a, b) => {
                  try {
                    if (matchFilter === 'live-upcoming') {
                      const aToday = isToday(parseISO(a.date));
                      const bToday = isToday(parseISO(b.date));
                      if (aToday && !bToday) return -1;
                      if (!aToday && bToday) return 1;
                    }
                    return new Date(a.date).getTime() - new Date(b.date).getTime();
                  } catch (e) {
                    return 0;
                  }
                })
                .map((match) => {
                const currentPredictions = selectedUserForAdmin ? adminPredictions : predictions;
                const prediction = pendingPredictions[match.id] !== undefined 
    ? (pendingPredictions[match.id] === '' ? null : { predictedWinner: pendingPredictions[match.id] })
    : currentPredictions.find(p => p.matchId === match.id);
  
                const effectiveStatus = getEffectiveStatus(match);
                const isPending = pendingPredictions[match.id] !== undefined || pendingToss[match.id] !== undefined;
                const isLocked = isAfter(new Date(), parseISO(match.date)) || effectiveStatus !== 'UPCOMING';

                // Toss prediction state
                const savedFullPred = currentPredictions.find(p => p.matchId === match.id);
                const tossPending = pendingToss[match.id];
                const currentTossWinner = tossPending?.tossWinner ?? savedFullPred?.tossWinner ?? '';
                const currentBattingChoice = tossPending?.battingChoice ?? savedFullPred?.battingChoice ?? '';
                const hasPredicted = !!prediction;
                
                // Use live vote counts computed from predictions (source of truth)
                const voteCounts = {
                  [match.homeTeam]: liveVoteCounts[match.id]?.[match.homeTeam] || 0,
                  [match.awayTeam]: liveVoteCounts[match.id]?.[match.awayTeam] || 0
                };
                
                const savedPrediction = currentPredictions.find(p => p.matchId === match.id);
                const pendingPrediction = pendingPredictions[match.id];
                
                if (pendingPrediction !== undefined) {
                  // Remove old saved vote from count if it exists
                  if (savedPrediction) {
                    const oldTeam = savedPrediction.predictedWinner;
                    if (voteCounts[oldTeam] !== undefined) {
                      voteCounts[oldTeam] = Math.max(0, voteCounts[oldTeam] - 1);
                    }
                  }
                  
                  // Add new pending vote to count if it's not empty
                  if (pendingPrediction !== '') {
                    if (voteCounts[pendingPrediction] !== undefined) {
                      voteCounts[pendingPrediction]++;
                    }
                  }
                }
                
                const totalVotes = voteCounts[match.homeTeam] + voteCounts[match.awayTeam];

                // Calculate live odds as losers/winners ratio
                const homeWinners = voteCounts[match.homeTeam];
                const awayWinners = voteCounts[match.awayTeam];
                const liveOdds = {
                  home: homeWinners > 0 ? parseFloat((awayWinners / homeWinners).toFixed(2)) : 0,
                  away: awayWinners > 0 ? parseFloat((homeWinners / awayWinners).toFixed(2)) : 0
                };
                
                return (
                  <motion.div 
                    layout
                    key={match.id}
                    className={cn(
                      "widget-container overflow-hidden transition-all",
                      effectiveStatus === 'LIVE' && "ring-2 ring-red-500/50 border-red-500/30 shadow-lg shadow-red-500/10"
                    )}
                  >
                    <div className="p-4 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-1.5 text-[#F27D26] mb-1">
                          {effectiveStatus === 'LIVE' ? (
                            <div className="flex items-center gap-1.5">
                              <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                              </span>
                              <span className="text-[10px] font-bold text-red-500 animate-pulse">LIVE NOW</span>
                            </div>
                          ) : (
                            <Clock className="w-3 h-3" />
                          )}
                          <div className="flex flex-col">
                            <span className="status-label text-[9px]">
                              {formatInTimeZone(parseISO(match.date), 'America/New_York', 'MMM d, h:mm a')} EST
                            </span>
                            <span className="text-[8px] text-gray-400 italic">USA: {format(parseISO(match.date), 'MM/dd/yyyy • h:mm a')}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 text-gray-400">
                          <MapPin className="w-3 h-3" />
                          <span className="text-xs truncate max-w-[200px]">{match.venue}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {match.type !== 'REGULAR' && (
                          <span className="px-2 py-0.5 rounded bg-orange-500/20 text-orange-400 text-[9px] font-bold border border-orange-500/30">
                            {match.type.replace('_', ' ')}
                          </span>
                        )}
                        <MatchBadge status={effectiveStatus} />
                      </div>
                      {isAdminUser && (
                        <button 
                          onClick={() => setEditingMatch(match)}
                          className="ml-2 p-1.5 rounded-lg bg-white/5 text-gray-400 hover:bg-white/10 transition-colors"
                        >
                          <Settings className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    <div className="p-6">
                      <div className="flex items-center justify-between gap-4 mb-8">
                        {/* Home Team */}
                        <div className={cn(
                          "flex-1 flex flex-col items-center gap-3 transition-opacity duration-300",
                          match.status === 'COMPLETED' && match.winner !== match.homeTeam && match.winner !== 'DRAW' && "opacity-40 grayscale-[0.5]"
                        )}>
                          <TeamLogo teamCode={match.homeTeam} size="lg" />
                          <div className="flex flex-col items-center">
                            <span className="font-bold text-sm text-center">{TEAMS[match.homeTeam as keyof typeof TEAMS]?.name}</span>
                            {totalVotes > 0 ? (
                              <div className="flex items-center gap-1 mt-0.5 bg-white/5 px-1.5 py-0.5 rounded border border-white/10">
                                <span className="text-[8px] text-[#F27D26] font-black">{liveOdds.home}</span>
                                <span className="text-[7px] text-gray-500 font-bold uppercase">odds</span>
                              </div>
                            ) : match.odds && match.odds.home !== undefined && (
                              <div className="flex items-center gap-1 mt-0.5 bg-white/5 px-1.5 py-0.5 rounded border border-white/10">
                                <span className="text-[8px] text-[#F27D26] font-black">{match.odds.home}</span>
                                <span className="text-[7px] text-gray-500 font-bold uppercase">pts</span>
                              </div>
                            )}
                            {match.homeScore && (
                              <span className="text-lg font-black text-white mt-1">{match.homeScore}</span>
                            )}
                            <button
                              onClick={() => setShowVoters({ matchId: match.id, teamCode: match.homeTeam })}
                              className="text-[11px] font-black text-[#F27D26] mt-2 hover:underline flex items-center gap-1.5 bg-white/5 px-2.5 py-1 rounded-full border border-[#F27D26]/20 transition-all hover:bg-[#F27D26]/10"
                            >
                              <UserIcon className="w-3 h-3" />
                              {voteCounts[match.homeTeam] || 0} {voteCounts[match.homeTeam] === 1 ? 'Vote' : 'Votes'}
                            </button>
                          </div>
                        </div>
                        
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-2xl font-black text-white/10 italic">VS</span>
                        </div>

                        {/* Away Team */}
                        <div className={cn(
                          "flex-1 flex flex-col items-center gap-3 transition-opacity duration-300",
                          match.status === 'COMPLETED' && match.winner !== match.awayTeam && match.winner !== 'DRAW' && "opacity-40 grayscale-[0.5]"
                        )}>
                          <TeamLogo teamCode={match.awayTeam} size="lg" />
                          <div className="flex flex-col items-center">
                            <span className="font-bold text-sm text-center">{TEAMS[match.awayTeam as keyof typeof TEAMS]?.name}</span>
                            {totalVotes > 0 ? (
                              <div className="flex items-center gap-1 mt-0.5 bg-white/5 px-1.5 py-0.5 rounded border border-white/10">
                                <span className="text-[8px] text-[#F27D26] font-black">{liveOdds.away}</span>
                                <span className="text-[7px] text-gray-500 font-bold uppercase">odds</span>
                              </div>
                            ) : match.odds && match.odds.away !== undefined && (
                              <div className="flex items-center gap-1 mt-0.5 bg-white/5 px-1.5 py-0.5 rounded border border-white/10">
                                <span className="text-[8px] text-[#F27D26] font-black">{match.odds.away}</span>
                                <span className="text-[7px] text-gray-500 font-bold uppercase">pts</span>
                              </div>
                            )}
                            {match.awayScore && (
                              <span className="text-lg font-black text-white mt-1">{match.awayScore}</span>
                            )}
                            <button
                              onClick={() => setShowVoters({ matchId: match.id, teamCode: match.awayTeam })}
                              className="text-[11px] font-black text-[#F27D26] mt-2 hover:underline flex items-center gap-1.5 bg-white/5 px-2.5 py-1 rounded-full border border-[#F27D26]/20 transition-all hover:bg-[#F27D26]/10"
                            >
                              <UserIcon className="w-3 h-3" />
                              {voteCounts[match.awayTeam] || 0} {voteCounts[match.awayTeam] === 1 ? 'Vote' : 'Votes'}
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Vote Progress Bar */}
                      {totalVotes > 0 && (
                        <div className="px-6 mb-4">
                          <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden flex">
                            <div 
                              className="h-full bg-[#F27D26] transition-all duration-500 border-r border-black/20"
                              style={{ width: `${(voteCounts[match.homeTeam] / totalVotes) * 100}%` }}
                            />
                            <div 
                              className="h-full bg-blue-500 transition-all duration-500"
                              style={{ width: `${(voteCounts[match.awayTeam] / totalVotes) * 100}%` }}
                            />
                          </div>
                          <div className="flex justify-between mt-1 text-[8px] font-mono text-gray-500 uppercase tracking-tighter">
                            <span>{((voteCounts[match.homeTeam] / totalVotes) * 100).toFixed(0)}% {match.homeTeam}</span>
                            <span>{((voteCounts[match.awayTeam] / totalVotes) * 100).toFixed(0)}% {match.awayTeam}</span>
                          </div>
                        </div>
                      )}

                      {/* Prediction Controls */}
                      <div className="space-y-4">
                        {(!isLocked || isAdminUser) ? (
                          <>
                          {/* Match Winner Prediction */}
                          <div>
                            <p className="text-[9px] font-bold uppercase text-gray-500 tracking-widest mb-2">Who Wins?</p>
                            <div className="grid grid-cols-2 gap-3">
                              <button
                                onClick={() => handlePredict(match.id, match.homeTeam)}
                                className={cn(
                                  "py-3 rounded-xl font-bold transition-all border-2 relative",
                                  prediction?.predictedWinner === match.homeTeam
                                    ? "bg-[#F27D26] border-[#F27D26] text-white shadow-lg shadow-orange-500/20"
                                    : "bg-white/5 border-transparent text-gray-400 hover:bg-white/10"
                                )}
                              >
                                {match.homeTeam}
                              </button>
                              <button
                                onClick={() => handlePredict(match.id, match.awayTeam)}
                                className={cn(
                                  "py-3 rounded-xl font-bold transition-all border-2 relative",
                                  prediction?.predictedWinner === match.awayTeam
                                    ? "bg-[#F27D26] border-[#F27D26] text-white shadow-lg shadow-orange-500/20"
                                    : "bg-white/5 border-transparent text-gray-400 hover:bg-white/10"
                                )}
                              >
                                {match.awayTeam}
                              </button>
                            </div>
                          </div>

                          {/* Toss & Batting Choice Prediction */}
                          <div className="pt-3 border-t border-white/5">
                            <div className="grid grid-cols-2 gap-4">
                              {/* Toss Winner */}
                              <div>
                                <p className="text-[9px] font-bold uppercase text-gray-500 tracking-widest mb-1.5">Toss Winner</p>
                                <div className="flex gap-1.5">
                                  <button
                                    onClick={() => handleTossPrediction(match.id, 'tossWinner', match.homeTeam)}
                                    className={cn(
                                      "flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-all border",
                                      currentTossWinner === match.homeTeam
                                        ? "bg-cyan-500/20 border-cyan-500/50 text-cyan-400"
                                        : "bg-white/5 border-transparent text-gray-500 hover:bg-white/10"
                                    )}
                                  >
                                    {match.homeTeam}
                                  </button>
                                  <button
                                    onClick={() => handleTossPrediction(match.id, 'tossWinner', match.awayTeam)}
                                    className={cn(
                                      "flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-all border",
                                      currentTossWinner === match.awayTeam
                                        ? "bg-cyan-500/20 border-cyan-500/50 text-cyan-400"
                                        : "bg-white/5 border-transparent text-gray-500 hover:bg-white/10"
                                    )}
                                  >
                                    {match.awayTeam}
                                  </button>
                                </div>
                              </div>
                              {/* Bat / Bowl Choice */}
                              <div>
                                <p className="text-[9px] font-bold uppercase text-gray-500 tracking-widest mb-1.5">Elects To</p>
                                <div className="flex gap-1.5">
                                  <button
                                    onClick={() => handleTossPrediction(match.id, 'battingChoice', 'BAT')}
                                    className={cn(
                                      "flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-all border",
                                      currentBattingChoice === 'BAT'
                                        ? "bg-amber-500/20 border-amber-500/50 text-amber-400"
                                        : "bg-white/5 border-transparent text-gray-500 hover:bg-white/10"
                                    )}
                                  >
                                    Bat 1st
                                  </button>
                                  <button
                                    onClick={() => handleTossPrediction(match.id, 'battingChoice', 'BOWL')}
                                    className={cn(
                                      "flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-all border",
                                      currentBattingChoice === 'BOWL'
                                        ? "bg-amber-500/20 border-amber-500/50 text-amber-400"
                                        : "bg-white/5 border-transparent text-gray-500 hover:bg-white/10"
                                    )}
                                  >
                                    Bowl 1st
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                          </>
                        ) : (
                          <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                            {match.status === 'COMPLETED' ? (
                              <div className="flex flex-col items-center gap-2">
                                <span className="status-label">Winner</span>
                                <div className="flex items-center gap-2 text-xl font-bold text-[#FFD700]">
                                  <Trophy className="w-5 h-5" />
                                  {match.winner}
                                </div>
                                {prediction && (
                                  <div className={cn(
                                    "mt-2 flex items-center gap-2 text-sm font-medium",
                                    prediction.predictedWinner === match.winner ? "text-green-400" : "text-red-400"
                                  )}>
                                    {prediction.predictedWinner === match.winner ? (
                                      <><CheckCircle2 className="w-4 h-4" /> Correct Prediction!</>
                                    ) : (
                                      <><XCircle className="w-4 h-4" /> Incorrect Prediction</>
                                    )}
                                  </div>
                                )}
                                {/* Show toss prediction result */}
                                {savedFullPred?.tossWinner && (
                                  <div className="mt-2 flex items-center gap-3 text-[10px]">
                                    <span className="text-gray-500">Toss: <span className="text-cyan-400 font-bold">{savedFullPred.tossWinner}</span></span>
                                    {savedFullPred.battingChoice && (
                                      <span className="text-gray-500">Elects: <span className="text-amber-400 font-bold">{savedFullPred.battingChoice === 'BAT' ? 'Bat 1st' : 'Bowl 1st'}</span></span>
                                    )}
                                  </div>
                                )}
                                {/* Admin: Edit prediction on completed match */}
                                {isAdminUser && showAdmin && (
                                  <div className="mt-3 pt-3 border-t border-white/10 w-full">
                                    <p className="text-[9px] font-bold uppercase text-gray-500 tracking-widest mb-2 text-center">Admin: Change Prediction</p>
                                    <div className="grid grid-cols-2 gap-2">
                                      <button
                                        onClick={() => handlePredict(match.id, match.homeTeam)}
                                        className={cn(
                                          "py-2 rounded-lg text-xs font-bold transition-all border",
                                          prediction?.predictedWinner === match.homeTeam
                                            ? "bg-blue-500/20 border-blue-500/40 text-blue-400"
                                            : "bg-white/5 border-transparent text-gray-500 hover:bg-white/10"
                                        )}
                                      >
                                        {match.homeTeam}
                                      </button>
                                      <button
                                        onClick={() => handlePredict(match.id, match.awayTeam)}
                                        className={cn(
                                          "py-2 rounded-lg text-xs font-bold transition-all border",
                                          prediction?.predictedWinner === match.awayTeam
                                            ? "bg-blue-500/20 border-blue-500/40 text-blue-400"
                                            : "bg-white/5 border-transparent text-gray-500 hover:bg-white/10"
                                        )}
                                      >
                                        {match.awayTeam}
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="flex flex-col items-center gap-1">
                                <AlertCircle className="w-5 h-5 text-gray-500 mb-1" />
                                <span className="text-sm font-medium text-gray-400">Predictions Locked</span>
                                {prediction && (
                                  <span className="text-xs text-[#F27D26]">You picked {prediction.predictedWinner}</span>
                                )}
                                {/* Show toss prediction on locked matches */}
                                {savedFullPred?.tossWinner && (
                                  <div className="mt-1 flex items-center gap-3 text-[10px]">
                                    <span className="text-gray-500">Toss: <span className="text-cyan-400 font-bold">{savedFullPred.tossWinner}</span></span>
                                    {savedFullPred.battingChoice && (
                                      <span className="text-gray-500">Elects: <span className="text-amber-400 font-bold">{savedFullPred.battingChoice === 'BAT' ? 'Bat 1st' : 'Bowl 1st'}</span></span>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Actions */}
                        <div className="flex items-center justify-between pt-2">
                          <div className="flex gap-2">
                            {(!isLocked || isAdminUser) && (
                              <>
                                {isPending && (
                                  <button 
                                    onClick={() => handleUndo(match.id)}
                                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 text-gray-400 text-xs font-bold hover:bg-white/10 transition-colors"
                                  >
                                    <Undo2 className="w-4 h-4" />
                                    Undo
                                  </button>
                                )}
                                {(hasPredicted || isPending) && (
                                  <button 
                                    onClick={() => handleClearSelection(match.id)}
                                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 text-xs font-bold hover:bg-red-500/20 transition-colors"
                                  >
                                    <X className="w-4 h-4" />
                                    Clear Selection
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                          
                          <div className="text-[10px] text-gray-500 font-mono flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                            LIVE ACTIVITY
                          </div>
                        </div>

                        {/* Admin Controls */}
                        {showAdmin && match.status !== 'COMPLETED' && (
                          <div className="mt-6 pt-6 border-t border-white/5">
                            <div className="flex items-center justify-between mb-3">
                              <p className="status-label">Admin: Set Result</p>
                            </div>
                            <div className="flex gap-2">
                              <button 
                                onClick={() => handleCompleteMatch(match, match.homeTeam)}
                                className="flex-1 py-2 rounded-lg bg-green-500/20 text-green-400 text-xs font-bold border border-green-500/30"
                              >
                                {match.homeTeam} Wins
                              </button>
                              <button 
                                onClick={() => handleCompleteMatch(match, match.awayTeam)}
                                className="flex-1 py-2 rounded-lg bg-green-500/20 text-green-400 text-xs font-bold border border-green-500/30"
                              >
                                {match.awayTeam} Wins
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <h2 className="text-lg font-bold flex items-center gap-2 mb-4">
              <Trophy className="w-5 h-5 text-[#F27D26]" />
              Global Leaderboard
            </h2>

            <div className="widget-container overflow-hidden">
              <div className="divide-y divide-white/5">
                {users.map((u, index) => {
                  const isTop3 = index < 3;
                  const badges = ['🥇', '🥈', '🥉'];
                  
                  return (
                    <div key={u.uid} className={cn(
                      "p-4 flex items-center justify-between transition-colors",
                      u.uid === user.uid ? "bg-[#F27D26]/5" : "hover:bg-white/[0.02]"
                    )}>
                      <div className="flex items-center gap-4">
                        <div className="w-8 text-center font-mono text-gray-500 text-sm">
                          {isTop3 ? badges[index] : index + 1}
                        </div>
                        <div className="relative">
                          <img src={u.photoURL} alt="" className="w-10 h-10 rounded-full border border-white/10" />
                          {u.uid === user.uid && (
                            <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-[#1A1D23]"></div>
                          )}
                        </div>
                        <div>
                          <div className="font-bold flex items-center gap-2">
                            {u.displayName}
                            {isTop3 && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#FFD700]/10 text-[#FFD700] border border-[#FFD700]/20 uppercase">
                                Throws the party!
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-gray-500 uppercase tracking-wider">
                            {u.skipsUsed || 0} Skips Used
                          </div>
                        </div>
                      </div>
                      
                        <div className="text-right flex items-center gap-4">
                        <div>
                          <div className="text-lg font-black ipl-text-gradient">
                            {u.totalPoints?.toFixed(1) || 0}
                          </div>
                          <div className="status-label text-[8px]">Points</div>
                        </div>
                        {isAdminUser && u.uid !== user.uid && (
                          <div className="flex items-center gap-2">
                            {(u.skipsUsed || 0) > 0 && (
                              <button
                                onClick={() => handleResetSkips(u.uid, u.displayName)}
                                className="p-2 rounded-lg bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 transition-colors"
                                title={`Reset Skips (${u.skipsUsed || 0} used)`}
                              >
                                <RotateCcw className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setSelectedUserForAdmin(u);
                                setActiveTab('matches');
                                setPendingPredictions({});
                                showToast(`Now managing predictions for ${u.displayName}`);
                              }}
                              className="p-2 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
                              title="Manage User Predictions"
                            >
                              <Settings className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setUserToDelete(u)}
                              className="p-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                              title="Delete User"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Admin Management Banner */}
      {isAdminUser && selectedUserForAdmin && (
        <div className="fixed top-0 left-0 right-0 z-[70] bg-blue-600 text-white py-2 px-4 flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-3">
            <Settings className="w-4 h-4 animate-spin-slow" />
            <span className="text-xs font-bold uppercase tracking-widest">
              Managing Predictions for: <span className="underline">{selectedUserForAdmin.displayName}</span>
            </span>
          </div>
          <button 
            onClick={() => {
              setSelectedUserForAdmin(null);
              setPendingPredictions({});
              showToast("Returned to your own predictions");
            }}
            className="px-3 py-1 bg-white/20 hover:bg-white/30 rounded text-[10px] font-black uppercase transition-colors"
          >
            Exit Management
          </button>
        </div>
      )}

      {/* Floating Save Button */}
      {(Object.keys(pendingPredictions).length > 0 || Object.keys(pendingToss).length > 0) && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="fixed bottom-28 left-1/2 -translate-x-1/2 z-[60] flex flex-col items-center gap-3"
        >
          <button
            onClick={() => { setPendingPredictions({}); setPendingToss({}); }}
            className="px-4 py-2 rounded-xl bg-white/10 text-gray-400 text-[10px] font-black uppercase tracking-widest hover:bg-white/20 transition-all border border-white/10"
          >
            Clear All Changes
          </button>
          <button
            onClick={saveAllPredictions}
            disabled={savingPredictions}
            className={cn(
              "flex items-center gap-3 px-8 py-4 rounded-2xl font-black text-white shadow-[0_20px_50px_rgba(242,125,38,0.4)] transition-all active:scale-95 border-2 border-white/20",
              savingPredictions ? "bg-gray-600 cursor-not-allowed" : "bg-gradient-to-r from-[#F27D26] to-[#FF6321] hover:scale-105"
            )}
          >
            {savingPredictions ? (
              <RefreshCw className="w-5 h-5 animate-spin" />
            ) : (
              <Save className="w-5 h-5" />
            )}
            <span className="uppercase tracking-widest text-sm font-black">
              {savingPredictions ? 'Saving...' : `Save ${Object.keys(pendingPredictions).length + Object.keys(pendingToss).length} Changes`}
            </span>
          </button>
        </motion.div>
      )}

      {/* Edit Match Modal */}
      {editingMatch && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-[#151619] border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
          >
            <div className="p-4 border-b border-white/5 flex items-center justify-between">
              <h3 className="font-bold">Edit Match Details</h3>
              <button onClick={() => setEditingMatch(null)} className="p-1 text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-[10px] uppercase text-gray-500 font-bold mb-1">Match Status</label>
                <select 
                  value={editingMatch.status}
                  onChange={(e) => setEditingMatch({ ...editingMatch, status: e.target.value as MatchStatus })}
                  className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:border-[#F27D26]"
                >
                  <option value="UPCOMING">Upcoming</option>
                  <option value="LIVE">Live</option>
                  <option value="COMPLETED">Completed</option>
                </select>
              </div>

              {editingMatch.status === 'COMPLETED' && (
                <div>
                  <label className="block text-[10px] uppercase text-gray-500 font-bold mb-1">Winner</label>
                  <select 
                    value={editingMatch.winner || ''}
                    onChange={(e) => setEditingMatch({ ...editingMatch, winner: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:border-[#F27D26]"
                  >
                    <option value="">Select Winner</option>
                    <option value={editingMatch.homeTeam}>{TEAMS[editingMatch.homeTeam as keyof typeof TEAMS]?.name}</option>
                    <option value={editingMatch.awayTeam}>{TEAMS[editingMatch.awayTeam as keyof typeof TEAMS]?.name}</option>
                    <option value="DRAW">Draw</option>
                    <option value="ABANDONED">Abandoned</option>
                  </select>
                </div>
              )}

              {(editingMatch.status === 'LIVE' || editingMatch.status === 'COMPLETED') && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] uppercase text-gray-500 font-bold mb-1">{editingMatch.homeTeam} Score</label>
                    <input 
                      type="text"
                      value={editingMatch.homeScore || ''}
                      onChange={(e) => setEditingMatch({ ...editingMatch, homeScore: e.target.value })}
                      className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:border-[#F27D26]"
                      placeholder="e.g. 185/4"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase text-gray-500 font-bold mb-1">{editingMatch.awayTeam} Score</label>
                    <input 
                      type="text"
                      value={editingMatch.awayScore || ''}
                      onChange={(e) => setEditingMatch({ ...editingMatch, awayScore: e.target.value })}
                      className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:border-[#F27D26]"
                      placeholder="e.g. 172/8"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-[10px] uppercase text-gray-500 font-bold mb-1">Lock Time (ISO Date)</label>
                <input 
                  type="text"
                  value={editingMatch.date}
                  onChange={(e) => setEditingMatch({ ...editingMatch, date: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-sm font-mono focus:outline-none focus:border-[#F27D26]"
                  placeholder="2026-03-28T09:00:00-05:00"
                />
                <p className="text-[10px] text-gray-500 mt-1 italic">Changing this will update when predictions are locked.</p>
              </div>

              <div>
                <label className="block text-[10px] uppercase text-gray-500 font-bold mb-1">Display Time (IST)</label>
                <input 
                  type="text"
                  value={editingMatch.dateIST}
                  onChange={(e) => setEditingMatch({ ...editingMatch, dateIST: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:border-[#F27D26]"
                  placeholder="28 Mar 2026, 7:30 PM IST"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] uppercase text-gray-500 font-bold mb-1">{editingMatch.homeTeam} Odds</label>
                  <input 
                    type="number"
                    step="0.01"
                    value={editingMatch.odds?.home || 0}
                    onChange={(e) => setEditingMatch({ 
                      ...editingMatch, 
                      odds: { 
                        home: parseFloat(e.target.value), 
                        away: editingMatch.odds?.away || 0 
                      } 
                    })}
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:border-[#F27D26]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase text-gray-500 font-bold mb-1">{editingMatch.awayTeam} Odds</label>
                  <input 
                    type="number"
                    step="0.01"
                    value={editingMatch.odds?.away || 0}
                    onChange={(e) => setEditingMatch({ 
                      ...editingMatch, 
                      odds: { 
                        home: editingMatch.odds?.home || 0, 
                        away: parseFloat(e.target.value) 
                      } 
                    })}
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:border-[#F27D26]"
                  />
                </div>
              </div>

              <div className="pt-4 flex gap-3">
                <button 
                  onClick={() => setEditingMatch(null)}
                  className="flex-1 py-2 rounded-lg bg-white/5 text-gray-400 font-bold text-sm hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => {
                    if (editingMatch.status === 'COMPLETED' && editingMatch.winner) {
                      handleCompleteMatch(editingMatch, editingMatch.winner);
                      setEditingMatch(null);
                    } else {
                      handleUpdateMatch(editingMatch.id, {
                        status: editingMatch.status,
                        winner: editingMatch.winner,
                        homeScore: editingMatch.homeScore,
                        awayScore: editingMatch.awayScore,
                        date: editingMatch.date,
                        dateIST: editingMatch.dateIST,
                        odds: editingMatch.odds
                      });
                    }
                  }}
                  className="flex-1 py-2 rounded-lg bg-[#F27D26] text-white font-bold text-sm hover:bg-[#F27D26]/80 transition-colors"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Delete User Confirmation Modal */}
      {userToDelete && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-[#151619] border border-white/10 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl"
          >
            <div className="p-6 text-center">
              <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <Trash2 className="w-8 h-8 text-red-500" />
              </div>
              <h3 className="text-xl font-bold mb-2 text-white">Discard User?</h3>
              <p className="text-gray-400 text-sm mb-6">
                Are you sure you want to discard <span className="text-white font-bold">{userToDelete.displayName}</span>? 
                This will delete their profile and all their predictions. This action cannot be undone.
              </p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setUserToDelete(null)}
                  className="flex-1 py-3 rounded-xl bg-white/5 text-gray-400 font-bold text-sm hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => handleDeleteUser(userToDelete.uid)}
                  className="flex-1 py-3 rounded-xl bg-red-500 text-white font-bold text-sm hover:bg-red-600 transition-colors"
                >
                  Discard
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Voters Modal */}
      {showVoters && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-[#151619] border border-white/10 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl"
          >
            <div className="p-4 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TeamLogo teamCode={showVoters.teamCode} size="sm" />
                <h3 className="font-bold text-sm">Voted for {showVoters.teamCode}</h3>
              </div>
              <button onClick={() => setShowVoters(null)} className="p-1 text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-2 max-h-[300px] overflow-y-auto">
              {loadingVoters ? (
                <div className="flex flex-col items-center justify-center p-8 gap-3">
                  <RefreshCw className="w-6 h-6 text-[#F27D26] animate-spin" />
                  <span className="text-xs text-gray-500">Loading voters...</span>
                </div>
              ) : voters.length > 0 ? (
                voters.map((voter) => (
                  <div key={voter.uid} className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5">
                    {voter.photoURL ? (
                      <img src={voter.photoURL} alt="" className="w-8 h-8 rounded-full border border-white/10" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                        <UserIcon className="w-4 h-4 text-gray-400" />
                      </div>
                    )}
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{voter.displayName}</span>
                      <span className="text-[10px] text-gray-500">{voter.totalPoints.toFixed(1)} pts</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-8 text-center text-gray-500 text-sm">No votes yet</div>
              )}
            </div>
          </motion.div>
        </div>
      )}

      {/* Bottom Navigation */}
      <nav className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-md bg-[#1A1D23]/90 backdrop-blur-xl border border-white/10 rounded-2xl p-2 flex gap-2 shadow-2xl z-50">
        <button 
          onClick={() => setActiveTab('matches')}
          className={cn(
            "flex-1 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all",
            activeTab === 'matches' ? "bg-[#F27D26] text-white" : "text-gray-400 hover:text-white"
          )}
        >
          <Calendar className="w-4 h-4" />
          Matches
        </button>
        <button 
          onClick={() => setActiveTab('leaderboard')}
          className={cn(
            "flex-1 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all",
            activeTab === 'leaderboard' ? "bg-[#F27D26] text-white" : "text-gray-400 hover:text-white"
          )}
        >
          <Trophy className="w-4 h-4" />
          Leaderboard
        </button>
      </nav>

      <footer className="max-w-4xl mx-auto p-8 mt-12 border-t border-white/5 text-center space-y-4">
        <div className="flex flex-col items-center gap-2">
          <div className="w-8 h-8 ipl-gradient rounded-lg flex items-center justify-center opacity-50">
            <Trophy className="w-4 h-4 text-white" />
          </div>
          <p className="text-sm font-bold text-gray-500">IPL Predictor 2026</p>
        </div>
        
        <div className="max-w-md mx-auto text-[10px] text-gray-500 leading-relaxed uppercase tracking-widest">
          <p>Disclaimer: This application is a fan-made project and is not affiliated with, endorsed by, or associated with the Indian Premier League (IPL), the BCCI, or any official cricket organization. All team names and logos are property of their respective owners.</p>
        </div>

        <div className="flex justify-center gap-6 text-[10px] font-bold text-gray-600 uppercase tracking-widest">
          <button className="hover:text-[#F27D26] transition-colors">Privacy Policy</button>
          <button className="hover:text-[#F27D26] transition-colors">Terms of Service</button>
          <button className="hover:text-[#F27D26] transition-colors">Contact Support</button>
        </div>
      </footer>
    </div>
  );
}