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

export default async function handler(req, res) {
    // CORS: Har jagah se (browsers, bots) request allow karne ke liye
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        // Browser URL se parameters nikalna
        const { key, paytm, amount, comment } = req.query;

        if (!key || !paytm || !amount) {
            return res.status(400).json({ status: "error", message: "Missing parameters! key, paytm aur amount zaroori hain." });
        }

        const withdrawAmount = Number(amount);
        if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
            return res.status(400).json({ status: "error", message: "Invalid amount!" });
        }

        // 1. Check if API Key is valid and find the Sender (Admin)
        const usersRef = ref(db, "users");
        const adminSnap = await get(query(usersRef, orderByChild("apiKey"), equalTo(key)));
        
        if (!adminSnap.exists()) {
            return res.status(401).json({ status: "error", message: "Invalid API Key!" });
        }

        let adminPhone = null, adminData = null;
        adminSnap.forEach((child) => { 
            adminPhone = child.key; 
            adminData = child.val(); 
        });

        // 2. Check Admin's Balance
        if ((Number(adminData.balance) || 0) < withdrawAmount) {
            return res.status(400).json({ status: "error", message: "API Owner has insufficient wallet balance!" });
        }

        // 3. Find the Receiver (Paytm Number user)
        const receiverSnap = await get(ref(db, "users/" + paytm));
        if (!receiverSnap.exists()) {
            return res.status(404).json({ status: "error", message: "Receiver mobile number is not registered in wallet!" });
        }
        let receiverData = receiverSnap.val();

        // 4. Generate Transactions & Exact Date
        const exactDate = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        const txnIdOut = "TXN" + Date.now().toString(36).toUpperCase() + "OUT";
        const txnIdIn = "TXN" + Date.now().toString(36).toUpperCase() + "IN";

        // 5. Update Database Atomically (Balance Deduct + Balance Add + History)
        const updates = {};
        
        // Admin (API Owner) ke wallet se amount minus (-)
        updates[`users/${adminPhone}/balance`] = increment(-withdrawAmount);
        
        // Receiver (Number) ke wallet mein amount plus (+)
        updates[`users/${paytm}/balance`] = increment(withdrawAmount);

        // Admin ki Transaction History
        updates[`transactions/${txnIdOut}`] = { 
            id: txnIdOut, type: "out", 
            title: "API Payment to " + (receiverData.name || paytm), 
            amount: withdrawAmount, status: "Success", date: exactDate, timestamp: Date.now(), 
            icon: "fa-code", color: "gray", senderId: adminPhone, receiverId: paytm 
        };

        // Receiver ki Transaction History
        updates[`transactions/${txnIdIn}`] = { 
            id: txnIdIn, type: "in", 
            title: "API Received from " + (adminData.name || adminPhone), 
            amount: withdrawAmount, status: "Success", date: exactDate, timestamp: Date.now(), 
            icon: "fa-arrow-down", color: "green", senderId: adminPhone, receiverId: paytm 
        };

        // Database ko update kar do
        await update(ref(db), updates);

        // Success Response browser pe show karne ke liye
        return res.status(200).json({ 
            status: "success", 
            message: `₹${withdrawAmount} successfully transferred to ${paytm}`,
            data: { 
                transaction_id: txnIdIn, 
                amount: withdrawAmount, 
                receiver: paytm,
                sender: adminPhone
            } 
        });

    } catch (error) { 
        return res.status(500).json({ status: "error", message: "Server Error: " + error.message }); 
    }
}
