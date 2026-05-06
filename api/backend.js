import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, set, update, runTransaction } from "firebase/database";

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
        if (action === 'CHECK_USER') {
            let targetPhone = String(data.phone).trim();
            let normalizedInput = targetPhone.toLowerCase(); 
            
            const customSnap = await get(ref(db, `custom_ids/${normalizedInput}`));
            if (customSnap.exists()) { 
                targetPhone = customSnap.val(); 
            }
            
            const snap = await get(ref(db, `users/${targetPhone}`));
            let userData = snap.exists() ? snap.val() : null;
            if (userData) {
                userData.resolvedPhone = targetPhone; 
            } else {
                const fallbackSnap = await get(ref(db, `users/${data.phone}`));
                if (fallbackSnap.exists()) {
                    userData = fallbackSnap.val();
                    userData.resolvedPhone = data.phone;
                }
            }
            return res.json({ data: userData });
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
        
        if (action === 'SET_CUSTOM_ID') {
            const { phone, customId } = data;
            const normalizedCustomId = String(customId).toLowerCase().trim(); 
            
            const uSnap = await get(ref(db, `users/${phone}`));
            if (!uSnap.exists()) throw new Error("User not found!");
            const user = uSnap.val();
            let currentBal = Number(user.balance) || 0;
            const cost = user.premium ? 3 : 5;
            
            if (currentBal < cost) throw new Error("Insufficient Balance for Custom ID!");
            
            const cidSnap = await get(ref(db, `custom_ids/${normalizedCustomId}`));
            if (cidSnap.exists()) throw new Error("This Custom ID is already taken by someone else!");
            
            const updates = {};
            updates[`users/${phone}/balance`] = currentBal - cost;
            updates[`users/${phone}/customId`] = normalizedCustomId;
            updates[`custom_ids/${normalizedCustomId}`] = phone;
            await update(ref(db), updates);
            return res.json({ data: "Success" });
        }

        if (action === 'ACTIVATE_PREMIUM') {
            const { phone, duration, cost } = data;
            const uSnap = await get(ref(db, `users/${phone}`));
            if (!uSnap.exists()) throw new Error("User not found!");
            let currentBal = Number(uSnap.val().balance) || 0;
            let cst = Number(cost) || 0;
            
            if (currentBal < cst) throw new Error("Insufficient Balance!");
            
            const updates = {};
            updates[`users/${phone}/balance`] = currentBal - cst; 
            updates[`users/${phone}/premium`] = true;
            updates[`users/${phone}/advancedUI`] = true; 
            updates[`users/${phone}/premiumExpiry`] = Date.now() + Number(duration); 
            await update(ref(db), updates);
            return res.json({ data: "Success" });
        }
        
        if (action === 'UPDATE_PREFS') {
            const updates = {};
            if(data.theme !== undefined) updates[`users/${data.phone}/theme`] = data.theme;
            if(data.tag !== undefined) updates[`users/${data.phone}/tag`] = data.tag;
            if(data.advancedUI !== undefined) updates[`users/${data.phone}/advancedUI`] = data.advancedUI;
            if(data.accentColor !== undefined) updates[`users/${data.phone}/accentColor`] = data.accentColor;
            if(data.customUserTag !== undefined) updates[`users/${data.phone}/customUserTag`] = data.customUserTag;
            if(data.colorfulMode !== undefined) updates[`users/${data.phone}/colorfulMode`] = data.colorfulMode;
            await update(ref(db), updates);
            return res.json({ data: "Success" });
        }

        if (action === 'GENERATE_API') {
            await update(ref(db, `users/${data.phone}`), { apiKey: data.newKey }); 
            return res.json({ data: "Success" });
        }

        if (action === 'SET_CUSTOM_API') {
            const { phone, newKey } = data;
            if (!newKey || /\s/.test(newKey)) throw new Error("Invalid API Key! Spaces are not allowed.");
            
            const usersSnap = await get(ref(db, 'users'));
            let exists = false;
            if(usersSnap.exists()){
                usersSnap.forEach(u => {
                    if(u.val().apiKey === newKey && u.key !== phone) exists = true;
                });
            }
            if(exists) throw new Error("This API Key is already taken by someone else!");
            
            await update(ref(db, `users/${phone}`), { apiKey: newKey });
            return res.json({ data: "Success" });
        }

        if (action === 'UPDATE_PRIVACY') {
            await update(ref(db), { [`users/${data.phone}/privacyMode`]: data.privacyMode });
            return res.json({ data: "Success" });
        }

        if (action === 'TOGGLE_TXN_VISIBILITY') {
            const { phone, txnId, isHidden } = data;
            if (isHidden) {
                await update(ref(db), { [`users/${phone}/hiddenTxns/${txnId}`]: true });
            } else {
                await update(ref(db), { [`users/${phone}/hiddenTxns/${txnId}`]: null });
            }
            return res.json({ data: "Success" });
        }

        if (action === 'SYNC') {
            if (!data.phone) throw new Error("Phone number missing for Sync");
            const safeRoundId = data.gameRoundId || 'NONE';
            
            const [uSnap, cSnap, tSnap, gSnap, pSnap] = await Promise.all([ 
                get(ref(db, `users/${data.phone}`)), 
                get(ref(db, "settings")), 
                get(ref(db, "transactions")), 
                get(ref(db, `game_rounds/${safeRoundId}`)),
                get(ref(db, "posts"))
            ]);
            
            let userData = uSnap.val() || {};
            
            if (userData.premium && userData.premiumExpiry) {
                if (Date.now() > Number(userData.premiumExpiry)) {
                    let newKey = 'LP-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();
                    userData = { ...userData, premium: false, premiumExpiry: null, theme: null, tag: null, advancedUI: false, accentColor: null, customUserTag: null, privacyMode: false, apiKey: newKey };
                    await update(ref(db, `users/${data.phone}`), { 
                        premium: false, premiumExpiry: null, theme: null, tag: null, advancedUI: false, accentColor: null, customUserTag: null, privacyMode: false, apiKey: newKey 
                    });
                }
            }

            let txns = [];
            if(tSnap.exists()) {
                tSnap.forEach(c => {
                    let t = c.val();
                    if(t.senderId === data.phone || t.receiverId === data.phone) {
                        let adaptedTxn = { ...t };
                        let rName = (t.name && t.name !== 'N/A') ? t.name : t.receiverId;
                        let sName = (t.senderName && t.senderName !== 'N/A') ? t.senderName : t.senderId;
                        if (t.senderId === data.phone && t.receiverId === data.phone) { adaptedTxn.type = t.type; } 
                        else if (t.senderId === data.phone) { 
                            adaptedTxn.type = 'out'; 
                            adaptedTxn.title = t.isApi ? `Sent via API to ${rName}` : `Sent to ${rName}`; 
                        } 
                        else if (t.receiverId === data.phone) { 
                            adaptedTxn.type = 'in'; 
                            if (t.senderId === 'SYSTEM' || t.senderId === data.phone || t.title.includes('Lifafa') || t.title.includes('Deposit via') || t.title.includes('Game') || t.title.includes('Gift') || t.title.includes('Maintenance Fee')) {
                                adaptedTxn.title = t.title;
                            } else {
                                adaptedTxn.title = t.isApi ? `API Payment Received from ${sName}` : `Received from ${sName}`; 
                            }
                            adaptedTxn.icon = t.icon || 'fa-arrow-down'; 
                            adaptedTxn.color = t.color || 'green'; 
                        }
                        txns.push(adaptedTxn);
                    }
                });
            }
            txns.sort((a, b) => b.timestamp - a.timestamp);

            let postsArr = [];
            if (pSnap.exists()) { pSnap.forEach(p => { postsArr.push(p.val()); }); }

            get(ref(db, 'game_rounds')).then(allGamesSnap => {
                if (allGamesSnap.exists()) {
                    let rounds = [];
                    allGamesSnap.forEach(child => { rounds.push(child.key); });
                    if (rounds.length > 5) {
                        rounds.sort(); 
                        let updates = {};
                        for(let i = 0; i < 3; i++) {
                            if (rounds[i]) updates[`game_rounds/${rounds[i]}`] = null;
                        }
                        update(ref(db), updates).catch(()=>{});
                    }
                }
            }).catch(()=>{});

            return res.json({ data: { user: userData, settings: cSnap.val() || {}, txns: txns, gameRound: gSnap.val() || { totalRed: 0, totalGreen: 0 }, posts: postsArr }});
        }

        if (action === 'EXECUTE_TXN') {
            let amt = Number(data.amount) || 0;
            if (data.amount !== undefined && amt <= 0) throw new Error("Amount must be greater than zero!");

            // Optimization: Parallel database reads for sender and receiver to reduce server lag
            const [uSnap, rSnap] = await Promise.all([
                get(ref(db, `users/${data.sender}`)),
                (data.mode === 'SEND' || data.mode === 'GHOST_SEND') && data.receiver 
                    ? get(ref(db, `users/${data.receiver}`)) 
                    : Promise.resolve(null)
            ]);

            if (!uSnap.exists()) throw new Error("User not found!");
            
            let sBal = Number(uSnap.val().balance) || 0;
            let sKeeper = Number(uSnap.val().keeperBalance) || 0;
            let isPremium = uSnap.val().premium === true;
            let senderName = uSnap.val().name || "User";
            let statusLabel = isPremium ? "(Premium)" : "(Normal)";

            // Zero Tax/Maintenance fees for Premium Users
            if (data.mode === 'DEPOSIT_FEE' && isPremium) {
                return res.json({ data: "Exempt from fees", serverResponse: { senderName, statusLabel } }); 
            }

            if (['SEND', 'GHOST_SEND', 'WITHDRAW', 'DEPOSIT_FEE', 'KEEPER_LOCK'].includes(data.mode)) {
                if (sBal < amt) throw new Error("Insufficient Balance!");
            }
            if (data.mode === 'KEEPER_WITHDRAW') {
                if (sKeeper < amt) throw new Error("Insufficient Keeper Balance!");
            }

            const updates = {};
            if (data.mode === 'SEND' || data.mode === 'GHOST_SEND') { 
                if (!rSnap || !rSnap.exists()) throw new Error("Receiver not found!");
                let rBal = Number(rSnap.val().balance) || 0;
                updates[`users/${data.sender}/balance`] = sBal - amt; 
                updates[`users/${data.receiver}/balance`] = rBal + amt; 
                if (data.mode === 'GHOST_SEND' && data.txn) {
                    data.txn.receiverId = "GHOST_HIDDEN"; 
                }
            }
            else if (data.mode === 'WITHDRAW') { updates[`users/${data.sender}/balance`] = sBal - amt; } 
            else if (data.mode === 'DEPOSIT_FEE') { 
                updates[`users/${data.sender}/balance`] = sBal - amt; 
                if (data.txn) { data.txn.title = "Server Maintenance Fee"; data.txn.type = "out"; data.txn.color = "red"; data.txn.icon = "fa-server"; }
            } 
            else if (data.mode === 'KEEPER_LOCK') { updates[`users/${data.sender}/balance`] = sBal - amt; updates[`users/${data.sender}/keeperBalance`] = sKeeper + amt; } 
            else if (data.mode === 'KEEPER_WITHDRAW') { updates[`users/${data.sender}/keeperBalance`] = sKeeper - amt; updates[`users/${data.sender}/balance`] = sBal + amt; } 
            else if (data.mode === 'GAME_WIN' || data.mode === 'GAME_REFUND' || data.mode === 'DEPOSIT') { updates[`users/${data.sender}/balance`] = sBal + amt; }
            
            if(data.txn) {
                data.txn.senderName = senderName;
                data.txn.senderStatus = statusLabel;
                updates[`transactions/${data.txn.id}`] = data.txn;
            }
            await update(ref(db), updates); 
            
            return res.json({ 
                data: "Success", 
                serverResponse: { message: "Payment processed successfully.", senderName, statusLabel }
            });
        }

        if (action === 'BULK_PAY') {
            let amt = Number(data.amount) || 0;
            if (amt <= 0) throw new Error("Amount must be greater than zero!");
            const total = amt * data.receivers.length;
            if (total <= 0) throw new Error("Invalid total amount!");
            
            const snap = await get(ref(db, `users/${data.sender}`));
            let sBal = Number(snap.val().balance) || 0;
            if (!snap.exists() || sBal < total) throw new Error("Insufficient Balance!");

            let isPremium = snap.val().premium === true;
            let senderName = snap.val().name || "User";
            let statusLabel = isPremium ? "(Premium)" : "(Normal)";

            const updates = { [`users/${data.sender}/balance`]: sBal - total };
            
            // Optimization: Parallel read for all bulk receivers
            const receiverSnaps = await Promise.all(data.receivers.map(num => get(ref(db, `users/${num}`))));

            for(let i = 0; i < data.receivers.length; i++) {
                let num = data.receivers[i];
                let rSnap = receiverSnaps[i];
                let rBal = rSnap.exists() ? Number(rSnap.val().balance) || 0 : 0;
                updates[`users/${num}/balance`] = rBal + amt;
                let txnId = 'TXN' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();
                updates[`transactions/${txnId}`] = { 
                    id: txnId, type: 'out', title: 'Bulk Send', amount: amt, status: 'Success', 
                    date: data.date, timestamp: Date.now(), icon: 'fa-paper-plane', color: 'yellow', 
                    name: 'User', number: num, senderId: data.sender, receiverId: num,
                    senderName: senderName, senderStatus: statusLabel 
                };
            }
            await update(ref(db), updates); 
            
            return res.json({ 
                data: "Success",
                serverResponse: { message: "Bulk payment processed.", senderName, statusLabel }
            });
        }

        if (action === 'CREATE_LIFAFA') {
            let totalDeduct = data.type === 'Scratch' ? Number(data.maxAmount) * Number(data.totalUsers) : Number(data.amount) * Number(data.totalUsers);
            if (totalDeduct <= 0) throw new Error("Invalid Lifafa Configuration!");

            const uSnap = await get(ref(db, `users/${data.phone}`));
            let sBal = Number(uSnap.val().balance) || 0;
            if (!uSnap.exists() || sBal < totalDeduct) throw new Error("Insufficient Balance!");
            
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            let lifafaId = ''; for(let i=0; i<10; i++) lifafaId += chars.charAt(Math.floor(Math.random() * chars.length));

            const updates = { 
                [`users/${data.phone}/balance`]: sBal - totalDeduct, 
                [`lifafas/${lifafaId}`]: { 
                    id: lifafaId, creator: data.phone, type: data.type || 'Standard', 
                    amount: Number(data.amount) || 0, minAmount: Number(data.minAmount) || 1, 
                    maxAmount: Number(data.maxAmount) || 0, totalUsers: Number(data.totalUsers), 
                    claimedUsers: 0, timestamp: Date.now(), status: 'ACTIVE', 
                    channel: (data.channel && data.channel.trim() !== "") ? data.channel.trim() : "", 
                    code: (data.code && data.code.trim() !== "") ? data.code.trim() : "",
                    isPremiumOnly: data.isPremiumOnly === true
                }, 
                [`transactions/${data.txn.id}`]: data.txn 
            };
            await update(ref(db), updates); 
            return res.json({ data: lifafaId });
        }

        if (action === 'GET_LIFAFA_INFO') {
            const snap = await get(ref(db, `lifafas/${data.code}`));
            if (!snap.exists() || snap.val().status !== 'ACTIVE') throw new Error("Lifafa not found or fully claimed.");
            return res.json({ data: { type: snap.val().type, channel: snap.val().channel, hasCode: (snap.val().code && snap.val().code.trim() !== ""), isPremiumOnly: snap.val().isPremiumOnly === true } });
        }

        if (action === 'CREATE_GIFT') {
            let amt = Number(data.amount) || 0;
            if (amt <= 0) throw new Error("Amount must be greater than zero!");
            const total = amt * data.users;
            if (total <= 0) throw new Error("Invalid total amount!");

            const snap = await get(ref(db, `users/${data.phone}`));
            let sBal = Number(snap.val().balance) || 0;
            if (!snap.exists() || sBal < total) throw new Error("Insufficient Balance!");

            const updates = { [`users/${data.phone}/balance`]: sBal - total, [`giftcodes/${data.code}`]: { amountPerUser: amt, remainingUsers: data.users, totalUsers: data.users, createdBy: data.phone }, [`transactions/${data.txn.id}`]: data.txn };
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
            const uSnap = await get(ref(db, `users/${data.phone}`));
            let uBal = Number(uSnap.val().balance) || 0;
            
            const updates = { [`users/${data.phone}/balance`]: uBal + resultAmount, [`transactions/${data.txn.id}`]: { ...data.txn, amount: resultAmount } };
            if (result.snapshot.val().remainingUsers <= 0) updates[`giftcodes/${data.code}`] = null; 
            await update(ref(db), updates); return res.json({ data: resultAmount });
        }

        if (action === 'GAME_BET') {
            let amt = Number(data.amount) || 0;
            if (amt <= 0) throw new Error("Amount must be greater than zero!");

            const uSnap = await get(ref(db, `users/${data.phone}`));
            let uBal = Number(uSnap.val().balance) || 0;
            if (!uSnap.exists() || uBal < amt) throw new Error("Insufficient Balance! Server sync failed.");

            const grSnap = await get(ref(db, `game_rounds/${data.roundId}`));
            let redTot = Number(grSnap.exists() ? grSnap.val().totalRed || 0 : 0);
            let greenTot = Number(grSnap.exists() ? grSnap.val().totalGreen || 0 : 0);

            const updates = { [`users/${data.phone}/balance`]: uBal - amt };
            if(data.color === 'red') updates[`game_rounds/${data.roundId}/totalRed`] = redTot + amt; 
            else updates[`game_rounds/${data.roundId}/totalGreen`] = greenTot + amt;
            
            if(data.txn) updates[`transactions/${data.txn.id}`] = data.txn;
            await update(ref(db), updates); return res.json({ data: "Success" });
        }

        return res.status(400).json({ error: "Unknown Action" });
    } catch (e) { return res.status(500).json({ error: e.message }); }
}
