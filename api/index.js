import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, query, orderByChild, equalTo, update, increment } from "firebase/database";

const firebaseConfig = {
  // ... (Your config stays same)
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
        // Ab yahan upi_id bhi fetch kar rahe hain
        const { key, paytm, amount, comment, number, upi_id } = req.query;
        
        const safeKey = String(key || "").trim();
        
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

        const currentAdminBal = Number(adminData.balance) || 0;

        // ==========================================
        // NEW UPI WITHDRAWAL API LOGIC
        // ==========================================
        if (upi_id) {
            const withdrawAmount = Number(amount);
            if (isNaN(withdrawAmount) || withdrawAmount < 10) {
                return res.status(400).json({ status: "error", message: "Minimum withdrawal amount is ₹10." });
            }
            if (currentAdminBal < withdrawAmount) {
                return res.status(400).json({ status: "error", message: "Insufficient Balance in API Owner's wallet!" });
            }

            const exactDate = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
            const txnId = "TXN" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();

            const updates = {};
            updates[`users/${adminPhone}/balance`] = increment(-withdrawAmount);
            updates[`transactions/${txnId}`] = { 
                id: txnId, type: "out", title: "API UPI Withdrawal", amount: withdrawAmount, 
                status: "Pending", date: exactDate, timestamp: Date.now(), 
                icon: "fa-university", color: "yellow", name: "Bank Withdraw", 
                number: upi_id, senderName: adminData.name || adminPhone,
                senderId: adminPhone, receiverId: upi_id, isApi: true
            };

            await update(ref(db), updates);

            // Send notification to Main Admin
            const settingsSnap = await get(ref(db, "settings"));
            let globalAdminChatId = settingsSnap.exists() ? settingsSnap.val().adminChatId : null;
            let withdrawMsg = `📤 <b>API WITHDRAWAL REQUEST</b> 💼✨\n\n👤 API Owner: <b>${adminData.name || adminPhone}</b>\n💰 Amount: ₹${withdrawAmount}\n🏦 UPI ID: <code>${upi_id}</code>\n🧾 Txn ID: <code>${txnId}</code>\n\n🔹 Please process this API request.`;
            if (globalAdminChatId) sendTelegramMsg(globalAdminChatId, withdrawMsg);

            // Send notification to API Owner
            if (adminData.tgUserId) {
                let userMsg = adminData.premium 
                    ? `🚀 <b>PREMIUM API ALERT</b> 🚀\n💎 UPI Withdrawal Requested! 🔥\n🏦 UPI: <b>${upi_id}</b>\n💰 Amount: ₹${withdrawAmount}\n🧾 Txn ID: <code>${txnId}</code>`
                    : `🏦 API Withdrawal Requested!\nUPI: ${upi_id}\nAmount: ₹${withdrawAmount}\nTxn ID: ${txnId}`;
                sendTelegramMsg(adminData.tgUserId, userMsg);
            }

            return res.status(200).json({ 
                status: "success", 
                message: `Withdrawal request of ₹${withdrawAmount} submitted for UPI: ${upi_id}`,
                data: { transaction_id: txnId, amount: withdrawAmount, upi_id: upi_id, sender: adminPhone }
            });
        }
        
        // ==========================================
        // NORMAL WALLET TRANSFER API LOGIC
        // ==========================================
        let targetNumber = String(paytm || number || "").trim(); 
        
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
