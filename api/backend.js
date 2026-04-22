import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, set, update, increment, remove } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyCVf5lRQ6t1gFbZeS9j2bf842NhoNrBX8M",
  authDomain: "lion-pay-a9557.firebaseapp.com",
  databaseURL: "https://lion-pay-a9557-default-rtdb.firebaseio.com",
  projectId: "lion-pay-a9557",
  storageBucket: "lion-pay-a9557.firebasestorage.app",
  messagingSenderId: "939533015657",
  appId: "1:939533015657:web:686447e1ba145e3c74a0f8"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: "Only POST allowed" });

    const { action, data } = req.body;

    try {
        // --- AUTH & USER LOGIC ---
        if (action === 'CHECK_USER') {
            const snap = await get(ref(db, `users/${data.phone}`));
            return res.json({ data: snap.exists() ? snap.val() : null });
        }

        if (action === 'LOGIN') {
            const snap = await get(ref(db, `users/${data.phone}`));
            if (!snap.exists() || snap.val().password !== data.password) throw new Error("Invalid Phone or Password!");
            if (snap.val().isBanned) throw new Error("Account is Banned.");
            return res.json({ data: snap.val() });
        }

        if (action === 'REGISTER') {
            const snap = await get(ref(db, `users/${data.phone}`));
            if (snap.exists()) throw new Error("Phone number already registered!");
            await set(ref(db, `users/${data.phone}`), data.userObj);
            return res.json({ data: "Success" });
        }

        if (action === 'UPDATE_CREDS') {
            await update(ref(db, `users/${data.phone}`), { password: data.password, pin: data.pin });
            return res.json({ data: "Success" });
        }

        // --- REALTIME SYNC LOGIC ---
        if (action === 'SYNC') {
            const [uSnap, cSnap, tSnap, gSnap] = await Promise.all([ 
                get(ref(db, `users/${data.phone}`)), 
                get(ref(db, "settings")),
                get(ref(db, "transactions")),
                get(ref(db, `game_rounds/${data.gameRoundId}`))
            ]);
            
            let txns = [];
            if(tSnap.exists()) {
                tSnap.forEach(c => {
                    let t = c.val();
                    if(t.senderId === data.phone || t.receiverId === data.phone) {
                        let adaptedTxn = { ...t };
                        if (t.senderId === data.phone && t.receiverId === data.phone) { adaptedTxn.type = t.type; } 
                        else if (t.senderId === data.phone) { adaptedTxn.type = 'out'; adaptedTxn.title = 'Sent to ' + (t.name !== 'N/A' ? t.name : t.receiverId); } 
                        else if (t.receiverId === data.phone) { adaptedTxn.type = 'in'; adaptedTxn.title = 'Received from ' + (t.name !== 'N/A' ? t.name : t.senderId); adaptedTxn.icon = 'fa-arrow-down'; adaptedTxn.color = 'green'; }
                        txns.push(adaptedTxn);
                    }
                });
            }
            txns.sort((a, b) => b.timestamp - a.timestamp);

            return res.json({ data: { 
                user: uSnap.val() || {}, 
                settings: cSnap.val() || {}, 
                txns: txns,
                gameRound: gSnap.val() || { totalRed: 0, totalGreen: 0 }
            }});
        }

        // --- TRANSACTIONS LOGIC ---
        if (action === 'EXECUTE_TXN') {
            const updates = {};
            
            // Handle Balances depending on Txn Type
            if (data.mode === 'SEND') {
                updates[`users/${data.sender}/balance`] = increment(-data.amount);
                updates[`users/${data.receiver}/balance`] = increment(data.amount);
            } else if (data.mode === 'DEPOSIT') {
                // Deposit is pending, only log txn
            } else if (data.mode === 'WITHDRAW') {
                updates[`users/${data.sender}/balance`] = increment(-data.amount);
            } else if (data.mode === 'KEEPER_LOCK') {
                updates[`users/${data.sender}/balance`] = increment(-data.amount);
                updates[`users/${data.sender}/keeperBalance`] = increment(data.amount);
            } else if (data.mode === 'KEEPER_WITHDRAW') {
                updates[`users/${data.sender}/keeperBalance`] = increment(-data.amount);
                updates[`users/${data.sender}/balance`] = increment(data.amount);
            } else if (data.mode === 'CARD_LOAD') {
                updates[`users/${data.sender}/balance`] = increment(-data.amount);
                updates[`users/${data.sender}/cardBalance`] = increment(data.amount);
            } else if (data.mode === 'CARD_WITHDRAW') {
                updates[`users/${data.sender}/cardBalance`] = increment(-data.amount);
                updates[`users/${data.sender}/balance`] = increment(data.amount);
            } else if (data.mode === 'CARD_PAY') {
                updates[`users/${data.sender}/cardBalance`] = increment(-data.amount);
            } else if (data.mode === 'GAME_REFUND' || data.mode === 'GAME_WIN') {
                 updates[`users/${data.sender}/balance`] = increment(data.amount);
            }

            updates[`transactions/${data.txn.id}`] = data.txn;
            await update(ref(db), updates);
            return res.json({ data: "Success" });
        }

        if (action === 'BULK_PAY') {
            const total = data.amount * data.receivers.length;
            const updates = { [`users/${data.sender}/balance`]: increment(-total) };
            
            data.receivers.forEach(num => {
                updates[`users/${num}/balance`] = increment(data.amount);
                let txnId = 'TXN' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();
                updates[`transactions/${txnId}`] = {
                    id: txnId, type: 'out', title: 'Bulk Send', amount: data.amount, status: 'Success', date: data.date, 
                    timestamp: Date.now(), icon: 'fa-paper-plane', color: 'yellow', name: 'User', number: num, 
                    senderId: data.sender, receiverId: num
                };
            });
            await update(ref(db), updates); 
            return res.json({ data: "Success" });
        }

        // --- LIFAFA SYSTEM (Imported from Reference Code) ---
        if (action === 'CREATE_LIFAFA') {
            let totalDeduct = Number(data.amount) * Number(data.totalUsers);
            if (totalDeduct <= 0 || isNaN(totalDeduct)) throw new Error("Invalid Parameters!");

            const uSnap = await get(ref(db, `users/${data.phone}`));
            if (!uSnap.exists() || uSnap.val().balance < totalDeduct) throw new Error("Insufficient Balance!");

            const newLifafa = {
                id: data.code, creator: data.phone, type: data.type, amount: Number(data.amount),
                totalUsers: Number(data.totalUsers), claimedUsers: 0, timestamp: Date.now(), status: 'ACTIVE'
            };

            const updates = {
                [`users/${data.phone}/balance`]: increment(-totalDeduct),
                [`lifafas/${data.code}`]: newLifafa,
                [`transactions/${data.txn.id}`]: data.txn
            };
            await update(ref(db), updates);
            return res.json({ data: "Success" });
        }

        // --- GIFT CODE LOGIC ---
        if (action === 'CREATE_GIFT') {
            const total = data.amount * data.users;
            const updates = {
                [`users/${data.phone}/balance`]: increment(-total),
                [`giftcodes/${data.code}`]: { amountPerUser: data.amount, remainingUsers: data.users, totalUsers: data.users, createdBy: data.phone },
                [`transactions/${data.txn.id}`]: data.txn
            };
            await update(ref(db), updates); 
            return res.json({ data: "Success" });
        }

        if (action === 'CLAIM_GIFT') {
            let resultAmount = 0;
            const codeRef = ref(db, `giftcodes/${data.code}`);
            
            // Transaction handles concurrent claims safely
            await update(ref(db), { dummy: null }); // Force connection
            const result = await db.transaction(codeRef, (currentData) => {
                if (currentData === null) return null; 
                if (currentData.claimers && currentData.claimers[data.phone]) return; 
                if (currentData.remainingUsers <= 0) return; 

                currentData.remainingUsers -= 1;
                if (!currentData.claimers) currentData.claimers = {};
                currentData.claimers[data.phone] = true;
                return currentData;
            });

            if (!result.committed) throw new Error("Code invalid, expired, or already claimed.");
            
            resultAmount = result.snapshot.val().amountPerUser;
            
            const updates = {
                [`users/${data.phone}/balance`]: increment(resultAmount),
                [`transactions/${data.txn.id}`]: data.txn
            };
            
            if (result.snapshot.val().remainingUsers <= 0) {
                updates[`giftcodes/${data.code}`] = null; // Delete if fully claimed
            }
            
            await update(ref(db), updates);
            return res.json({ data: resultAmount });
        }

        // --- API KEY / GAME LOGIC ---
        if (action === 'GENERATE_API') {
            await update(ref(db, `users/${data.phone}`), { apiKey: data.newKey });
            return res.json({ data: "Success" });
        }

        if (action === 'GAME_BET') {
            const updates = { [`users/${data.phone}/balance`]: increment(-data.amount) };
            if(data.color === 'red') {
                updates[`game_rounds/${data.roundId}/totalRed`] = increment(data.amount);
            } else {
                updates[`game_rounds/${data.roundId}/totalGreen`] = increment(data.amount);
            }
            await update(ref(db), updates);
            return res.json({ data: "Success" });
        }

        return res.status(400).json({ error: "Unknown Action" });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
