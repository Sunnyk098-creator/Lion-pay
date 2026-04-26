import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, set, update, increment, runTransaction } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyCVf5lRQ6t1gFbZeS9j2bf842NhoNrBX8M",
  authDomain: "lion-pay-a9557.firebaseapp.com",
  databaseURL: "https://lion-pay-a9557-default-rtdb.firebaseio.com",
  projectId: "lion-pay-a9557",
  storageBucket: "lion-pay-a9557.firebasestorage.app",
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

        if (action === 'SYNC') {
            const safeRoundId = data.gameRoundId || 'NONE';
            
            // FETCHING ADMIN MESSAGES ALSO IN PARALLEL
            const [uSnap, cSnap, tSnap, gSnap, mSnap] = await Promise.all([ 
                get(ref(db, `users/${data.phone}`)), 
                get(ref(db, "settings")), 
                get(ref(db, "transactions")), 
                get(ref(db, `game_rounds/${safeRoundId}`)),
                get(ref(db, "admin_messages"))
            ]);
            
            let txns = [];
            if(tSnap.exists()) {
                tSnap.forEach(c => {
                    let t = c.val();
                    if(t.senderId === data.phone || t.receiverId === data.phone) {
                        let adaptedTxn = { ...t };
                        let rName = (t.name && t.name !== 'N/A') ? t.name : t.receiverId;
                        let sName = (t.senderName && t.senderName !== 'N/A') ? t.senderName : t.senderId;
                        if (t.senderId === data.phone && t.receiverId === data.phone) { adaptedTxn.type = t.type; } 
                        else if (t.senderId === data.phone) { adaptedTxn.type = 'out'; adaptedTxn.title = t.isApi ? `Sent via API to ${rName}` : `Sent to ${rName}`; } 
                        else if (t.receiverId === data.phone) { adaptedTxn.type = 'in'; adaptedTxn.title = t.isApi ? `API Payment Received from ${sName}` : `Received from ${sName}`; adaptedTxn.icon = 'fa-arrow-down'; adaptedTxn.color = 'green'; }
                        txns.push(adaptedTxn);
                    }
                });
            }
            txns.sort((a, b) => b.timestamp - a.timestamp);

            let adminMsgs = [];
            if(mSnap.exists()) {
                mSnap.forEach(m => adminMsgs.push(m.val()));
            }
            adminMsgs.sort((a, b) => a.timestamp - b.timestamp);

            return res.json({ data: { user: uSnap.val() || {}, settings: cSnap.val() || {}, txns: txns, gameRound: gSnap.val() || { totalRed: 0, totalGreen: 0 }, adminMessages: adminMsgs }});
        }

        if (action === 'EXECUTE_TXN') {
            const updates = {};
            if (data.mode === 'SEND') { updates[`users/${data.sender}/balance`] = increment(-Number(data.amount)); updates[`users/${data.receiver}/balance`] = increment(Number(data.amount)); } 
            else if (data.mode === 'WITHDRAW' || data.mode === 'DEPOSIT_FEE') { updates[`users/${data.sender}/balance`] = increment(-Number(data.amount)); } 
            else if (data.mode === 'KEEPER_LOCK') { updates[`users/${data.sender}/balance`] = increment(-Number(data.amount)); updates[`users/${data.sender}/keeperBalance`] = increment(Number(data.amount)); } 
            else if (data.mode === 'KEEPER_WITHDRAW') { updates[`users/${data.sender}/keeperBalance`] = increment(-Number(data.amount)); updates[`users/${data.sender}/balance`] = increment(Number(data.amount)); } 
            else if (data.mode === 'GAME_WIN' || data.mode === 'GAME_REFUND') { updates[`users/${data.sender}/balance`] = increment(Number(data.amount)); }
            
            if(data.txn) updates[`transactions/${data.txn.id}`] = data.txn;
            await update(ref(db), updates); return res.json({ data: "Success" });
        }

        if (action === 'BULK_PAY') {
            const total = Number(data.amount) * data.receivers.length;
            const updates = { [`users/${data.sender}/balance`]: increment(-total) };
            data.receivers.forEach(num => {
                updates[`users/${num}/balance`] = increment(Number(data.amount));
                let txnId = 'TXN' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();
                updates[`transactions/${txnId}`] = { id: txnId, type: 'out', title: 'Bulk Send', amount: Number(data.amount), status: 'Success', date: data.date, timestamp: Date.now(), icon: 'fa-paper-plane', color: 'yellow', name: 'User', number: num, senderId: data.sender, receiverId: num };
            });
            await update(ref(db), updates); return res.json({ data: "Success" });
        }

        if (action === 'CREATE_LIFAFA') {
            let totalDeduct = 0;
            if(data.type === 'Scratch Card') { totalDeduct = Number(data.maxAmount) * Number(data.totalUsers); } 
            else { totalDeduct = Number(data.amount) * Number(data.totalUsers); }

            const uSnap = await get(ref(db, `users/${data.phone}`));
            if (!uSnap.exists() || (Number(uSnap.val().balance) || 0) < totalDeduct) throw new Error("Insufficient Balance!");
            
            const newLifafa = { 
                id: data.id, creator: data.phone, type: data.type, amount: Number(data.amount) || 0,
                minAmount: Number(data.minAmount) || 0, maxAmount: Number(data.maxAmount) || 0, tossSide: data.tossSide || '',
                totalUsers: Number(data.totalUsers), claimedUsers: 0, timestamp: Date.now(), status: 'ACTIVE', 
                channel: data.channel || "", code: data.code || ""
            };
            
            const updates = { 
                [`users/${data.phone}/balance`]: increment(-totalDeduct), [`lifafas/${data.id}`]: newLifafa, 
                [`transactions/${data.txn.id}`]: data.txn, [`users/${data.phone}/my_lifafas/${data.id}`]: true
            };
            await update(ref(db), updates); return res.json({ data: "Success" });
        }

        if (action === 'GET_MY_LIFAFAS') {
            const uSnap = await get(ref(db, `users/${data.phone}/my_lifafas`));
            if(!uSnap.exists()) return res.json({ data: [] });
            
            let ids = Object.keys(uSnap.val()); let lifs = [];
            for(let id of ids) {
                let s = await get(ref(db, `lifafas/${id}`));
                if(s.exists()) {
                    let l = s.val();
                    if(l.status === 'ACTIVE' && (Date.now() - l.timestamp > 72 * 60 * 60 * 1000)) {
                        l.status = 'EXPIRED'; await update(ref(db, `lifafas/${id}`), { status: 'EXPIRED' });
                    }
                    lifs.push(l);
                }
            }
            lifs.sort((a,b) => b.timestamp - a.timestamp); return res.json({ data: lifs });
        }

        if (action === 'GET_LIFAFA_INFO') {
            const snap = await get(ref(db, `lifafas/${data.code}`));
            if (!snap.exists()) throw new Error("Lifafa not found.");
            let lData = snap.val();
            if (lData.status === 'ACTIVE' && (Date.now() - lData.timestamp > 72 * 60 * 60 * 1000)) {
                lData.status = 'EXPIRED'; await update(ref(db, `lifafas/${data.code}`), { status: 'EXPIRED' });
            }
            return res.json({ data: { type: lData.type, channel: lData.channel, hasCode: (lData.code && lData.code !== ''), totalUsers: lData.totalUsers, claimedUsers: lData.claimedUsers, status: lData.status }});
        }

        if (action === 'CLAIM_LIFAFA') {
            let wonAmount = 0; let tossResultStr = ''; const lifafaRef = ref(db, `lifafas/${data.id}`);
            await update(ref(db), { dummy: null }); let lDataInfo = null;

            const result = await runTransaction(lifafaRef, (currentData) => {
                if (currentData === null) return null; 
                if (currentData.status === 'ACTIVE' && (Date.now() - currentData.timestamp > 72 * 60 * 60 * 1000)) {
                    currentData.status = 'EXPIRED'; lDataInfo = currentData; return currentData;
                }
                if (currentData.status !== 'ACTIVE') return;
                if (currentData.code && currentData.code !== data.code) return; 
                if (currentData.claimers && currentData.claimers[data.phone]) return; 
                if (currentData.claimedUsers >= currentData.totalUsers) return; 

                if (currentData.type === 'Scratch Card') { wonAmount = Math.floor(Math.random() * (currentData.maxAmount - currentData.minAmount + 1)) + currentData.minAmount; } 
                else if (currentData.type === 'Coin Toss') {
                    let outcomes = ['Head', 'Tail']; tossResultStr = outcomes[Math.floor(Math.random() * 2)];
                    if(tossResultStr === currentData.tossSide) wonAmount = currentData.amount; else wonAmount = 0;
                } else { wonAmount = currentData.amount; }

                currentData.claimedUsers = (currentData.claimedUsers || 0) + 1;
                if (!currentData.claimers) currentData.claimers = {}; currentData.claimers[data.phone] = true;
                if (currentData.claimedUsers >= currentData.totalUsers) currentData.status = 'COMPLETED';
                lDataInfo = currentData; return currentData;
            });

            if (!result.committed || !lDataInfo) throw new Error("Lifafa invalid, expired, wrong code, or already claimed.");
            if (lDataInfo.status === 'EXPIRED' && !lDataInfo.claimers[data.phone]) throw new Error("This Lifafa has expired (72h limit).");
            if (lDataInfo.code && lDataInfo.code !== data.code) throw new Error("Incorrect Unique Code!");

            const updates = {};
            const uSnap = await get(ref(db, `users/${data.phone}`));
            if(!uSnap.exists()) updates[`users/${data.phone}`] = { phone: data.phone, balance: wonAmount, name: "New User", isBanned: false };
            else updates[`users/${data.phone}/balance`] = increment(wonAmount);
            
            if(wonAmount > 0) updates[`transactions/${data.txn.id}`] = { ...data.txn, amount: wonAmount };
            await update(ref(db), updates); 
            return res.json({ data: { amount: wonAmount, type: lDataInfo.type, tossResult: tossResultStr } });
        }

        if (action === 'CREATE_GIFT') {
            const total = Number(data.amount) * data.users;
            const updates = { [`users/${data.phone}/balance`]: increment(-total), [`giftcodes/${data.code}`]: { amountPerUser: Number(data.amount), remainingUsers: data.users, totalUsers: data.users, createdBy: data.phone }, [`transactions/${data.txn.id}`]: data.txn };
            await update(ref(db), updates); return res.json({ data: "Success" });
        }

        if (action === 'CLAIM_GIFT') {
            let resultAmount = 0; const codeRef = ref(db, `giftcodes/${data.code}`); await update(ref(db), { dummy: null }); 
            const result = await runTransaction(codeRef, (currentData) => {
                if (currentData === null) return null; if (currentData.claimers && currentData.claimers[data.phone]) return; if (currentData.remainingUsers <= 0) return; 
                currentData.remainingUsers -= 1; if (!currentData.claimers) currentData.claimers = {}; currentData.claimers[data.phone] = true; return currentData;
            });
            if (!result.committed) throw new Error("Code invalid, expired, or already claimed.");
            
            resultAmount = Number(result.snapshot.val().amountPerUser);
            const updates = { [`users/${data.phone}/balance`]: increment(resultAmount), [`transactions/${data.txn.id}`]: { ...data.txn, amount: resultAmount } };
            if (result.snapshot.val().remainingUsers <= 0) updates[`giftcodes/${data.code}`] = null; 
            await update(ref(db), updates); return res.json({ data: resultAmount });
        }

        if (action === 'GENERATE_API') {
            await update(ref(db, `users/${data.phone}`), { apiKey: data.newKey }); return res.json({ data: "Success" });
        }
        
        // NEW: DEPOSIT API KEY GENERATOR
        if (action === 'GENERATE_DEPOSIT_API') {
            await update(ref(db, `users/${data.phone}`), { depositApiKey: data.newKey }); return res.json({ data: "Success" });
        }

        if (action === 'GAME_BET') {
            const uSnap = await get(ref(db, `users/${data.phone}`));
            if (!uSnap.exists() || (Number(uSnap.val().balance) || 0) < Number(data.amount)) {
                throw new Error("Insufficient Balance! Server sync failed.");
            }
            const updates = { [`users/${data.phone}/balance`]: increment(-Number(data.amount)) };
            if(data.color === 'red') updates[`game_rounds/${data.roundId}/totalRed`] = increment(Number(data.amount)); 
            else updates[`game_rounds/${data.roundId}/totalGreen`] = increment(Number(data.amount));
            if(data.txn) updates[`transactions/${data.txn.id}`] = data.txn;
            await update(ref(db), updates); return res.json({ data: "Success" });
        }

        return res.status(400).json({ error: "Unknown Action" });
    } catch (e) { return res.status(500).json({ error: e.message }); }
}
