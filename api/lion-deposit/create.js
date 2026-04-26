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

async function sendTelegramMsg(chatId, text) {
    try {
        if (!chatId) return false;
        let res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: text })
        });
        return (await res.json()).ok;
    } catch (e) { return false; }
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { key, number, amount } = req.query;

        if (!key || !number || !amount) {
            return res.status(400).json({ status: "error", message: "Missing parameters! key, number or amount required." });
        }

        const depositAmount = Number(amount);
        if (isNaN(depositAmount) || depositAmount <= 0) {
            return res.status(400).json({ status: "error", message: "Invalid deposit amount!" });
        }

        // 1. Authenticate Sender's Deposit API Key
        const usersRef = ref(db, "users");
        const adminSnap = await get(query(usersRef, orderByChild("depositApiKey"), equalTo(key)));
        
        if (!adminSnap.exists()) {
            return res.status(401).json({ status: "error", message: "Invalid or Expired Deposit API Key!" });
        }

        let adminPhone = null, adminData = null;
        adminSnap.forEach((child) => { adminPhone = child.key; adminData = child.val(); });

        if (adminPhone === number) {
            return res.status(400).json({ status: "error", message: "You cannot deposit to your own wallet via API!" });
        }

        const currentAdminBal = Number(adminData.balance) || 0;
        if (currentAdminBal < depositAmount) {
            return res.status(400).json({ status: "error", message: "Insufficient Balance in API Owner's Wallet!" });
        }

        // 2. Validate Receiver
        const receiverSnap = await get(ref(db, "users/" + number));
        if (!receiverSnap.exists()) {
            return res.status(404).json({ status: "error", message: "Receiver mobile number is not registered!" });
        }
        let receiverData = receiverSnap.val();

        // 3. Process Transaction & Auto-Reset Key
        const exactDate = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        const txnIdOut = "DEP_OUT" + Date.now().toString(36).toUpperCase();
        const txnIdIn = "DEP_IN" + Date.now().toString(36).toUpperCase();

        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let newKey = 'LWDP-';
        for(let i=0; i<12; i++) newKey += chars.charAt(Math.floor(Math.random() * chars.length));

        const updates = {};
        updates[`users/${adminPhone}/balance`] = increment(-depositAmount);
        updates[`users/${number}/balance`] = increment(depositAmount);
        updates[`users/${adminPhone}/depositApiKey`] = newKey; // KEY RESET!

        updates[`transactions/${txnIdOut}`] = { 
            id: txnIdOut, type: "out", title: "Deposit API Sent to " + (receiverData.name || number), 
            amount: depositAmount, status: "Success", date: exactDate, timestamp: Date.now(), 
            icon: "fa-code", color: "gray", name: receiverData.name || number, number: number,
            senderName: adminData.name || adminPhone, senderId: adminPhone, receiverId: number 
        };

        updates[`transactions/${txnIdIn}`] = { 
            id: txnIdIn, type: "in", title: "Deposit", 
            amount: depositAmount, status: "Success", date: exactDate, timestamp: Date.now(), 
            icon: "fa-wallet", color: "green", name: adminData.name || adminPhone, number: adminPhone,
            senderName: adminData.name || adminPhone, senderId: adminPhone, receiverId: number 
        };

        await update(ref(db), updates);

        let rName = receiverData.name || number;
        if (adminData.tgUserId) sendTelegramMsg(adminData.tgUserId, `🤖 Deposit API Sent!\nTo: ${rName}\nAmount: ₹${depositAmount}\nStatus: Key Reset Successful`);
        if (receiverData.tgUserId) sendTelegramMsg(receiverData.tgUserId, `💰 Wallet Deposit!\nAmount: ₹${depositAmount}\nStatus: Success`);

        return res.status(200).json({ 
            status: "success", 
            message: `Deposit of ₹${depositAmount} successful to ${number}. Your Deposit API Key has been reset.`,
            data: { transaction_id: txnIdIn, amount: depositAmount, receiver: number, new_key: newKey } 
        });

    } catch (error) { 
        return res.status(500).json({ status: "error", message: "Server Error" }); 
    }
}
