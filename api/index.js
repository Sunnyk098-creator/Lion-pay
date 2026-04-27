import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, query, orderByChild, equalTo, update, increment } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyCVf5lRQ6t1gFbZeS9j2bf842NhoNrBX8M",
  authDomain: "lion-pay-a9557.firebaseapp.com",
  databaseURL: "https://lion-pay-a9557-default-rtdb.firebaseio.com",
  projectId: "lion-pay-a9557",
  storageBucket: "lion-pay-a9557.firebasestorage.app",
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const BOT_TOKEN = "7980852115:AAF_Tf6WL-mGm_IMkt4QP3Yu8LKZoc6JSUg";

// Fast async without awaiting it entirely to prevent late response
async function sendTelegramMsg(chatId, text) {
    try {
        if (!chatId) return false;
        fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: text })
        });
        return true;
    } catch (e) { return false; }
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { key, paytm, amount, comment, number } = req.query;
        
        const safeKey = String(key || "").trim();
        const targetNumber = String(paytm || number || "").trim(); 

        if (!safeKey) {
            return res.status(400).json({ status: "error", message: "Missing API Key!" });
        }

        const isDepositApi = safeKey.startsWith('LWDP-');
        const usersRef = ref(db, "users");
        
        const adminQueryField = isDepositApi ? "depositApiKey" : "apiKey";
        const adminSnap = await get(query(usersRef, orderByChild(adminQueryField), equalTo(safeKey)));
        
        if (!adminSnap.exists()) {
            return res.status(401).json({ status: "error", message: "Invalid API Key! Old key is expired or incorrect." });
        }

        let adminPhone = null, adminData = {};
        adminSnap.forEach((child) => { 
            adminPhone = child.key; 
            adminData = child.val() || {}; 
        });

        // 1. Check Missing Parameters
        if (!targetNumber || !amount) {
            return res.status(400).json({ status: "error", message: "Missing target number or amount required." });
        }

        // 2. Check Invalid Amount
        const withdrawAmount = Number(amount);
        if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
            return res.status(400).json({ status: "error", message: "Invalid amount!" });
        }

        // 3. Check Self Transfer
        if (String(adminPhone) === targetNumber) {
            return res.status(400).json({ status: "error", message: "API Owner cannot send payment to their own number (Self-transfer not allowed)!" });
        }

        // Generate New Deposit Key (But don't save it yet)
        let newDepKey = null;
        if (isDepositApi) {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            newDepKey = 'LWDP-';
            for(let i=0; i<12; i++) newDepKey += chars.charAt(Math.floor(Math.random() * chars.length));
        }

        // 4. Strict Balance Check (Reset Key here if Insufficient Balance)
        const currentAdminBal = Number(adminData.balance) || 0;
        if (currentAdminBal < withdrawAmount) {
            // INSUFFICIENT BALANCE WALI CONDITION MEIN KEY RESET KARNA HAI
            if (isDepositApi && newDepKey) {
                await update(ref(db), { [`users/${adminPhone}/depositApiKey`]: newDepKey });
            }
            return res.status(400).json({ status: "error", message: "Insufficient Balance in API Owner's wallet!" });
        }

        // 5. Check if Receiver Exists
        const receiverSnap = await get(ref(db, "users/" + targetNumber));
        if (!receiverSnap.exists()) {
            return res.status(404).json({ status: "error", message: "Receiver mobile number is not registered in wallet!" });
        }
        let receiverData = receiverSnap.val() || {};

        // SUCCESSFUL PAYMENT PROCESS START
        const exactDate = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        const txnId = "TXN" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();

        const updates = {};
        
        // Deduct from Sender & Add to Receiver
        updates[`users/${adminPhone}/balance`] = increment(-withdrawAmount);
        updates[`users/${targetNumber}/balance`] = increment(withdrawAmount);

        let txnTitle = isDepositApi ? "Deposit via API" : "API Payment";
        let txnIcon = isDepositApi ? "fa-download" : "fa-code";
        let txnColor = isDepositApi ? "green" : "gray";

        updates[`transactions/${txnId}`] = { 
            id: txnId, 
            type: "out", 
            title: txnTitle, 
            amount: withdrawAmount, 
            status: "Success", 
            date: exactDate, 
            timestamp: Date.now(), 
            icon: txnIcon, 
            color: txnColor, 
            name: receiverData.name || targetNumber, 
            number: targetNumber,
            senderName: adminData.name || adminPhone,
            senderId: adminPhone, 
            receiverId: targetNumber,
            isApi: true,
            isDeposit: isDepositApi
        };

        // SUCCESS WALI CONDITION MEIN KEY RESET KARNA HAI
        if (isDepositApi && newDepKey) {
            updates[`users/${adminPhone}/depositApiKey`] = newDepKey;
        }

        // Execute all updates simultaneously
        await update(ref(db), updates);

        let rName = receiverData.name || targetNumber;
        let aName = adminData.name || adminPhone;
        
        if (adminData.tgUserId) {
            let msgType = isDepositApi ? "Deposit API Sent!" : "API Payment Sent!";
            sendTelegramMsg(adminData.tgUserId, `🤖 ${msgType}\nTo: ${rName}\nAmount: ₹${withdrawAmount}\nTxn ID: ${txnId}`);
        }
        if (receiverData.tgUserId) {
            let msgType = isDepositApi ? "API Deposit Received!" : "API Payment Received!";
            sendTelegramMsg(receiverData.tgUserId, `💰 ${msgType}\nFrom: ${aName}\nAmount: ₹${withdrawAmount}\nTxn ID: ${txnId}`);
        }

        let resData = { transaction_id: txnId, amount: withdrawAmount, receiver: targetNumber, sender: adminPhone };
        if (isDepositApi) resData.new_deposit_api_key = newDepKey; 

        return res.status(200).json({ 
            status: "success", 
            message: `Payment successful to ${targetNumber}`,
            data: resData
        });

    } catch (error) { 
        return res.status(500).json({ status: "error", message: "Server Error: " + (error.message || "Unknown error") }); 
    }
}
