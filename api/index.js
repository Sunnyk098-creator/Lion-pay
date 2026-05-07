import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, query, orderByChild, equalTo, update, increment } from "firebase/database";

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

const BOT_TOKEN = "7980852115:AAF_Tf6WL-mGm_IMkt4QP3Yu8LKZoc6JSUg";

async function sendTelegramMsg(chatId, text) {
    try {
        if (!chatId) return false;
        fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML' })
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
        const { key, paytm, amount, comment, number, action, Receiver } = req.query;
        
        const safeKey = String(key || "").trim();
        let targetNumber = String(paytm || number || "").trim(); 

        if (!safeKey) {
            return res.status(400).json({ status: "error", message: "Missing API Key!" });
        }

        const usersRef = ref(db, "users");
        const adminSnap = await get(query(usersRef, orderByChild("apiKey"), equalTo(safeKey)));
        
        if (!adminSnap.exists()) {
            return res.status(401).json({ status: "error", message: "Invalid API Key! Old key is expired or incorrect." });
        }

        let adminPhone = null, adminData = {};
        adminSnap.forEach((child) => { 
            adminPhone = child.key; 
            adminData = child.val() || {}; 
        });

        // ONLY PREMIUM USERS CAN USE API & INVOICE
        if (adminData.premium !== true) {
            return res.status(403).json({ status: "error", message: "API features and Invoice Creation are exclusively for Premium Users! Please upgrade your account." });
        }

        if (action === 'create_invoice') {
            let invoiceReceiver = String(Receiver || targetNumber || adminPhone).trim();
            const invAmount = Number(amount);
            
            if (isNaN(invAmount) || invAmount <= 0) {
                return res.status(400).json({ status: "error", message: "Invalid amount for invoice!" });
            }

            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            let invoiceId = '';
            for(let i=0; i<10; i++) invoiceId += chars.charAt(Math.floor(Math.random() * chars.length));

            const invoiceData = {
                id: invoiceId,
                receiver: invoiceReceiver,
                amount: invAmount,
                createdAt: Date.now(),
                expiresAt: Date.now() + (30 * 60 * 1000) 
            };

            await update(ref(db), { [`invoices/${invoiceId}`]: invoiceData });

            const domain = req.headers.host || "lion-pay.vercel.app";
            const invoiceLink = `https://${domain}/?invoice=${invoiceId}`;

            return res.status(200).json({
                status: "success",
                message: "Invoice created successfully",
                invoice_link: invoiceLink,
                data: invoiceData
            });
        }

        if (!targetNumber || !amount) {
            return res.status(400).json({ status: "error", message: "Missing target number or amount required." });
        }

        const withdrawAmount = Number(amount);
        if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
            return res.status(400).json({ status: "error", message: "Invalid amount!" });
        }

        const customSnap = await get(ref(db, `custom_ids/${targetNumber.toLowerCase()}`));
        if (customSnap.exists()) {
            targetNumber = customSnap.val();
        }

        if (String(adminPhone) === targetNumber) {
            return res.status(400).json({ status: "error", message: "API Owner cannot send payment to their own number!" });
        }

        const currentAdminBal = Number(adminData.balance) || 0;
        if (currentAdminBal < withdrawAmount) {
            return res.status(400).json({ status: "error", message: "Insufficient Balance in API Owner's wallet!" });
        }

        const receiverSnap = await get(ref(db, "users/" + targetNumber));
        if (!receiverSnap.exists()) {
            return res.status(404).json({ status: "error", message: "Receiver mobile number or Custom ID is not registered in wallet!" });
        }
        let receiverData = receiverSnap.val() || {};

        const exactDate = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        const txnId = "TXN" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();

        const updates = {};
        updates[`users/${adminPhone}/balance`] = increment(-withdrawAmount);
        updates[`users/${targetNumber}/balance`] = increment(withdrawAmount);

        updates[`transactions/${txnId}`] = { 
            id: txnId, type: "out", title: "API Payment", amount: withdrawAmount, 
            status: "Success", date: exactDate, timestamp: Date.now(), 
            icon: "fa-code", color: "gray", name: receiverData.name || targetNumber, 
            number: targetNumber, senderName: adminData.name || adminPhone,
            senderId: adminPhone, receiverId: targetNumber, isApi: true
        };

        await update(ref(db), updates);

        let rName = receiverData.name || targetNumber;
        let aName = adminData.name || adminPhone;
        
        let senderTag = adminData.premium ? "(Premium)" : "(Normal)";
        let finalSenderName = `${aName} ${senderTag}`;

        if (adminData.tgUserId) {
            let msg = adminData.premium 
                ? `🚀 <b>PREMIUM API ALERT</b> 🚀\n💎 Payment Sent! 🔥\n👤 To: <b>${rName}</b>\n💰 Amount: ₹${withdrawAmount}\n🧾 Txn ID: <code>${txnId}</code>`
                : `🤖 API Payment Sent!\nTo: ${rName}\nAmount: ₹${withdrawAmount}\nTxn ID: ${txnId}`;
            sendTelegramMsg(adminData.tgUserId, msg);
        }
        if (receiverData.tgUserId) {
            let msg = receiverData.premium 
                ? `🚀 <b>PREMIUM API ALERT</b> 🚀\n💎 Payment Received! 🎉\n👤 From: <b>${aName}</b>\n💰 Amount: ₹${withdrawAmount}\n🧾 Txn ID: <code>${txnId}</code>`
                : `💰 API Payment Received!\nFrom: ${aName}\nAmount: ₹${withdrawAmount}\nTxn ID: ${txnId}`;
            sendTelegramMsg(receiverData.tgUserId, msg);
        }

        return res.status(200).json({ 
            status: "success", 
            message: `Payment successful to ${targetNumber}`,
            data: { 
                transaction_id: txnId, 
                amount: withdrawAmount, 
                receiver: targetNumber, 
                sender: adminPhone,
                sender_name: finalSenderName
            }
        });

    } catch (error) { 
        return res.status(500).json({ status: "error", message: "Server Error: " + (error.message || "Unknown error") }); 
    }
}
