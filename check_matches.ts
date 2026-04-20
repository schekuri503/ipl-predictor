import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import firebaseConfig from './firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function checkMatches() {
  console.log('Fetching matches from Firestore...');
  const matchesSnap = await getDocs(collection(db, 'matches'));
  matchesSnap.forEach(doc => {
    const data = doc.data();
    if (data.status === 'ABANDONED' || data.id === 'ipl_2026_13') {
      console.log(`Match ID: ${data.id}, Status: ${data.status}, Winner: ${data.winner}, Date: ${data.date}`);
    }
  });
}

checkMatches().catch(console.error);
