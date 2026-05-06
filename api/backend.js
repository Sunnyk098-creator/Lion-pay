// backend.js
const DB_URL = "https://lion-pay-a9557-default-rtdb.firebaseio.com";

// --- Custom Firebase REST API Helpers (Bypasses Serverless Websocket Freezes) ---
async function getDb(path) {
    const res = await fetch(`${DB_URL}/${path}.json`, { cache: 'no-store' });
    return await res.json();
}

async function updateDb(updates) {
    const res = await fetch(`${DB_URL}/.json`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
    });
    if (!res.ok) throw new Error("Database update failed");
    return await res.json();
}

async function setDb(path, data) {
    const res = await fetch(`${DB_URL}/${path}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error("Database set failed");
    return await res.json();
}
// ---------------------------------------------------------------------------------

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
            
            const customIdData = await getDb(`custom_ids/${normalizedInput}`);
            if (customIdData !== null) targetPhone = customIdData; 
            
            let userData = await getDb(`users/${targetPhone}`);
            if (userData !== null) {
                userData.resolvedPhone = targetPhone; 
            } else {
                const fallbackData = await getDb(`users/${data.phone}`);
                if (fallbackData !== null) {
                    userData = fallbackData;
                    userData.resolvedPhone = data.phone;
                }
            }
            return res.json({ data: userData });
        }

        if (action === 'LOGIN') {
            const userData = await getDb(`users/${data.phone}`);
            if (userData === null || userData.password !== data.password) throw new Error("Invalid Phone or Password!");
            if (userData.isBanned) throw new Error("Account is Banned.");
            return res.json({ data: userData });
        }

        if (action === 'REGISTER') {
            const userData = await getDb(`users/${data.phone}`);
            if (userData !== null) throw new Error("Phone number already registered!");
            await setDb(`users/${data.phone}`, data.userObj);
            return res.json({ data: "Success" });
        }

        if (action === 'UPDATE_CREDS') {
            await updateDb({ 
                [`users/${data.phone}/password`]: data.password, 
                [`users/${data.phone}/pin`]: data.pin 
            });
            return res.json({ data: "Success" });
        }
        
        if (action === 'SET_CUSTOM_ID') {
            const { phone, customId } = data;
            const normalizedCustomId = String(customId).toLowerCase().trim(); 
            
            const user = await getDb(`users/${phone}`);
            if (user === null) throw new Error("User not found!");
            
            let currentBal = Number(user.balance) || 0;
            const cost = user.premium ? 3 : 5;
            
            if (currentBal < cost) throw new Error("Insufficient Balance for Custom ID!");
            
            const cidData = await getDb(`custom_ids/${normalizedCustomId}`);
            if (cidData !== null) throw new Error("This Custom ID is already taken by someone else!");
            
            const updates = {};
            updates[`users/${phone}/balance`] = currentBal - cost;
            updates[`users/${phone}/customId`] = normalizedCustomId;
            updates[`custom_ids/${normalizedCustomId}`] = phone;
            await updateDb(updates);
            return res.json({ data: "Success" });
        }

        if (action === 'ACTIVATE_PREMIUM') {
            const { phone, duration, cost } = data;
            const userVal = await getDb(`users/${phone}`);
            if (userVal === null) throw new Error("User not found!");
            
            let currentBal = Number(userVal.balance) || 0;
            let cst = Number(cost) || 0;
            
            if (currentBal < cst) throw new Error("Insufficient Balance!");
            
            let txnId = 'TXN' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();
            
            const updates = {};
            updates[`users/${phone}/balance`] = currentBal - cst; 
            updates[`users/${phone}/premium`] = true;
            updates[`users/${phone}/advancedUI`] = true; 
            updates[`users/${phone}/premiumExpiry`] = Date.now() + Number(duration); 
            
            updates[`transactions/${txnId}`] = {
                id: txnId,
                type: 'out',
                title: 'Premium Subscription',
                amount: cst,
                status: 'Success',
                date: new Date().toLocaleString(),
                timestamp: Date.now(),
                icon: 'fa-crown',
                color: 'yellow',
                name: 'System',
                number: 'N/A',
                senderId: phone,
                receiverId: 'SYSTEM'
            };

            await updateDb(updates);
            return res.json({ data: "Success" });
        }
        
        if (action === 'UPDATE_PREFS') {
            const updates = {};
            if(data.theme !== undefined) updates[`users/${data.phone}/theme`] = data.theme;
            if(data.tag !== undefined) updates[`users/${data.phone}/tag`] = data.tag;
            if(data.advancedUI !== undefined) updates[`users/${data.phone}/advancedUI`] = data.advancedUI;
            if(data.accentColor !== undefined) updates[`users/${data.phone}/accentColor`] = data.accentColor;
            if(data.customUserTag !== undefined) updates[`users/${data.phone}/customUserTag`] = data.customUserTag;
            await updateDb(updates);
            return res.json({ data: "Success" });
        }

        if (action === 'GENERATE_API') {
            await updateDb({ [`users/${data.phone}/apiKey`]: data.newKey }); 
            return res.json({ data: "Success" });
        }

        if (action === 'SET_CUSTOM_API') {
            const { phone, newKey } = data;
            
            if (!newKey || /\s/.test(newKey)) {
                throw new Error("Invalid API Key! Spaces are not allowed.");
            }
            
            const usersSnap = await getDb('users');
            let exists = false;
            
            if(usersSnap !== null){
                Object.keys(usersSnap).forEach(key => {
                    let u = usersSnap[key];
                    if(u.apiKey === newKey && key !== phone) exists = true;
                });
            }
            if(exists) throw new Error("This API Key is already taken by someone else!");
            
            await updateDb({ [`users/${phone}/apiKey`]: newKey });
            return res.json({ data: "Success" });
        }

        if (action === 'UPDATE_PRIVACY') {
            await updateDb({ [`users/${data.phone}/privacyMode`]: data.privacyMode });
            return res.json({ data: "Success" });
        }

        if (action === 'TOGGLE_TXN_VISIBILITY') {
            const { phone, txnId, isHidden } = data;
            if (isHidden) {
                await updateDb({ [`users/${phone}/hiddenTxns/${txnId}`]: true });
            } else {
                await updateDb({ [`users/${phone}/hiddenTxns/${txnId}`]: null });
            }
            return res.json({ data: "Success" });
        }

        if (action === 'SYNC') {
            if (!data.phone) throw new Error("Phone number missing for Sync");
            const safeRoundId = data.gameRoundId || 'NONE';
            
            const [userData, cSnap, tSnap, gSnap, pSnap] = await Promise.all([ 
                getDb(`users/${data.phone}`), 
                getDb("settings"), 
                getDb("transactions"), 
                getDb(`game_rounds/${safeRoundId}`),
                getDb("posts")
            ]);
            
            let finalUser = userData || {};
            
            if (finalUser.premium && finalUser.premiumExpiry) {
                if (Date.now() > Number(finalUser.premiumExpiry)) {
                    let newKey = 'LP-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();
                    
                    finalUser.premium = false; finalUser.premiumExpiry = null; finalUser.theme = null;
                    finalUser.tag = null; finalUser.advancedUI = false; finalUser.accentColor = null;
                    finalUser.customUserTag = null; finalUser.privacyMode = false; finalUser.apiKey = newKey; 
                    
                    await updateDb({ 
                        [`users/${data.phone}/premium`]: false, [`users/${data.phone}/premiumExpiry`]: null, 
                        [`users/${data.phone}/theme`]: null, [`users/${data.phone}/tag`]: null, 
                        [`users/${data.phone}/advancedUI`]: false, [`users/${data.phone}/accentColor`]: null, 
                        [`users/${data.phone}/customUserTag`]: null, [`users/${data.phone}/privacyMode`]: false, 
                        [`users/${data.phone}/apiKey`]: newKey 
                    });
                }
            }

            let txns = [];
            if(tSnap !== null) {
                Object.values(tSnap).forEach(t => {
                    if(t && (t.senderId === data.phone || t.receiverId === data.phone)) {
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
                            if (t.senderId === 'SYSTEM' || t.senderId === data.phone || t.title.includes('Lifafa') || t.title.includes('Deposit via') || t.title.includes('Game') || t.title.includes('Gift') || t.title.includes('Maintenance Fee') || t.title.includes('Premium Subscription')) {
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
            if (pSnap !== null) { Object.values(pSnap).forEach(p => { if(p) postsArr.push(p); }); }

            let allGamesSnap = await getDb('game_rounds');
            if (allGamesSnap !== null) {
                let rounds = Object.keys(allGamesSnap);
                if (rounds.length > 5) {
                    rounds.sort(); 
                    let gameUpdates = {};
                    for(let i = 0; i < 3; i++) {
                        if (rounds[i]) gameUpdates[`game_rounds/${rounds[i]}`] = null;
                    }
                    updateDb(gameUpdates).catch(()=>{});
                }
            }

            return res.json({ data: { user: finalUser, settings: cSnap || {}, txns: txns, gameRound: gSnap || { totalRed: 0, totalGreen: 0 }, posts: postsArr }});
        }

        if (action === 'EXECUTE_TXN') {
            let amt = Number(data.amount) || 0;
            if (data.amount !== undefined && amt <= 0) throw new Error("Amount must be greater than zero!");

            const userVal = await getDb(`users/${data.sender}`);
            if (userVal === null) throw new Error("User not found!");
            
            let sBal = Number(userVal.balance) || 0;
            let sKeeper = Number(userVal.keeperBalance) || 0;
            let isPremium = userVal.premium === true;

            if (data.mode === 'DEPOSIT_FEE' && isPremium) {
                return res.json({ data: "Exempt from fees" }); 
            }

            if (['SEND', 'GHOST_SEND', 'WITHDRAW', 'DEPOSIT_FEE', 'KEEPER_LOCK'].includes(data.mode)) {
                if (sBal < amt) throw new Error("Insufficient Balance!");
            }
            if (data.mode === 'KEEPER_WITHDRAW') {
                if (sKeeper < amt) throw new Error("Insufficient Keeper Balance!");
            }

            const updates = {};
            if (data.mode === 'SEND') { 
                const rVal = await getDb(`users/${data.receiver}`);
                let rBal = Number(rVal ? rVal.balance : 0) || 0;
                updates[`users/${data.sender}/balance`] = sBal - amt; 
                updates[`users/${data.receiver}/balance`] = rBal + amt; 
            } 
            else if (data.mode === 'GHOST_SEND') { 
                const rVal = await getDb(`users/${data.receiver}`);
                let rBal = Number(rVal ? rVal.balance : 0) || 0;
                updates[`users/${data.sender}/balance`] = sBal - amt; 
                updates[`users/${data.receiver}/balance`] = rBal + amt; 
                if (data.txn) {
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
            
            if(data.txn) updates[`transactions/${data.txn.id}`] = data.txn;
            await updateDb(updates); return res.json({ data: "Success" });
        }

        if (action === 'BULK_PAY') {
            let amt = Number(data.amount) || 0;
            if (amt <= 0) throw new Error("Amount must be greater than zero!");
            const total = amt * data.receivers.length;
            if (total <= 0) throw new Error("Invalid total amount!");
            
            const userVal = await getDb(`users/${data.sender}`);
            if (userVal === null) throw new Error("Insufficient Balance!");
            let sBal = Number(userVal.balance) || 0;
            if (sBal < total) throw new Error("Insufficient Balance!");

            const updates = { [`users/${data.sender}/balance`]: sBal - total };
            
            for(let num of data.receivers) {
                const rVal = await getDb(`users/${num}`);
                let rBal = rVal !== null ? Number(rVal.balance) || 0 : 0;
                updates[`users/${num}/balance`] = rBal + amt;
                let txnId = 'TXN' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();
                updates[`transactions/${txnId}`] = { id: txnId, type: 'out', title: 'Bulk Send', amount: amt, status: 'Success', date: data.date, timestamp: Date.now(), icon: 'fa-paper-plane', color: 'yellow', name: 'User', number: num, senderId: data.sender, receiverId: num };
            }
            await updateDb(updates); return res.json({ data: "Success" });
        }

        if (action === 'CREATE_LIFAFA') {
            let totalDeduct = data.type === 'Scratch' ? Number(data.maxAmount) * Number(data.totalUsers) : Number(data.amount) * Number(data.totalUsers);
            if (totalDeduct <= 0) throw new Error("Invalid Lifafa Configuration!");

            const uVal = await getDb(`users/${data.phone}`);
            if (uVal === null) throw new Error("Insufficient Balance!");
            let sBal = Number(uVal.balance) || 0;
            if (sBal < totalDeduct) throw new Error("Insufficient Balance!");
            
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
            await updateDb(updates); 
            return res.json({ data: lifafaId });
        }

        if (action === 'GET_LIFAFA_INFO') {
            const lifData = await getDb(`lifafas/${data.code}`);
            if (lifData === null || lifData.status !== 'ACTIVE') throw new Error("Lifafa not found or fully claimed.");
            return res.json({ data: { type: lifData.type, channel: lifData.channel, hasCode: (lifData.code && lifData.code.trim() !== ""), isPremiumOnly: lifData.isPremiumOnly === true } });
        }

        if (action === 'CREATE_GIFT') {
            let amt = Number(data.amount) || 0;
            if (amt <= 0) throw new Error("Amount must be greater than zero!");
            const total = amt * data.users;
            if (total <= 0) throw new Error("Invalid total amount!");

            const uVal = await getDb(`users/${data.phone}`);
            if (uVal === null) throw new Error("Insufficient Balance!");
            let sBal = Number(uVal.balance) || 0;
            if (sBal < total) throw new Error("Insufficient Balance!");

            const updates = { 
                [`users/${data.phone}/balance`]: sBal - total, 
                [`giftcodes/${data.code}`]: { amountPerUser: amt, remainingUsers: data.users, totalUsers: data.users, createdBy: data.phone }, 
                [`transactions/${data.txn.id}`]: data.txn 
            };
            await updateDb(updates); return res.json({ data: "Success" });
        }

        if (action === 'CLAIM_GIFT') {
            const giftData = await getDb(`giftcodes/${data.code}`);
            if (giftData === null) throw new Error("Code invalid or expired.");
            if (giftData.claimers && giftData.claimers[data.phone]) throw new Error("Already claimed.");
            if (giftData.remainingUsers <= 0) throw new Error("Fully claimed.");
            
            let resultAmount = Number(giftData.amountPerUser);
            
            const uVal = await getDb(`users/${data.phone}`);
            let uBal = Number(uVal ? uVal.balance : 0) || 0;
            
            const updates = {};
            updates[`giftcodes/${data.code}/remainingUsers`] = giftData.remainingUsers - 1;
            updates[`giftcodes/${data.code}/claimers/${data.phone}`] = true;
            if (giftData.remainingUsers - 1 <= 0) updates[`giftcodes/${data.code}`] = null; 
            
            updates[`users/${data.phone}/balance`] = uBal + resultAmount;
            updates[`transactions/${data.txn.id}`] = { ...data.txn, amount: resultAmount };
            
            await updateDb(updates); return res.json({ data: resultAmount });
        }

        if (action === 'GAME_BET') {
            let amt = Number(data.amount) || 0;
            if (amt <= 0) throw new Error("Amount must be greater than zero!");

            const uVal = await getDb(`users/${data.phone}`);
            if (uVal === null) throw new Error("Insufficient Balance! Server sync failed.");
            let uBal = Number(uVal.balance) || 0;
            if (uBal < amt) throw new Error("Insufficient Balance! Server sync failed.");

            const grVal = await getDb(`game_rounds/${data.roundId}`);
            let redTot = Number(grVal !== null ? grVal.totalRed || 0 : 0);
            let greenTot = Number(grVal !== null ? grVal.totalGreen || 0 : 0);

            const updates = { [`users/${data.phone}/balance`]: uBal - amt };
            if(data.color === 'red') updates[`game_rounds/${data.roundId}/totalRed`] = redTot + amt; 
            else updates[`game_rounds/${data.roundId}/totalGreen`] = greenTot + amt;
            
            if(data.txn) updates[`transactions/${data.txn.id}`] = data.txn;
            await updateDb(updates); return res.json({ data: "Success" });
        }

        return res.status(400).json({ error: "Unknown Action" });
    } catch (e) { return res.status(500).json({ error: e.message }); }
}
