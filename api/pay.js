import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, query, orderByChild, equalTo, update } from "firebase/database";

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
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { key, paytm, amount, comment } = req.query;

        if (!key || !paytm || !amount) return res.status(400).json({ status: "error", message: "Missing parameters!" });

        const withdrawAmount = Number(amount);
        if (isNaN(withdrawAmount) || withdrawAmount <= 0) return res.status(400).json({ status: "error", message: "Invalid amount!" });

        // Lion Pay uses LP- prefix for API keys
        if (!key.startsWith("LP-")) return res.status(401).json({ status: "error", message: "Invalid API Key format!" });

        const usersRef = ref(db, "users");
        const qAdmin = query(usersRef, orderByChild("apiKey"), equalTo(key));
        const adminSnap = await get(qAdmin);

        if (!adminSnap.exists()) return res.status(401).json({ status: "error", message: "Invalid API Key!" });

        let adminPhone = null;
        let adminData = null;
        
        adminSnap.forEach((child) => {
            adminPhone = child.key;
            adminData = child.val();
        });

        const currentAdminBal = Number(adminData.balance) || 0;
        if (currentAdminBal < withdrawAmount) return res.status(400).json({ status: "error", message: "API Owner has insufficient balance!" });

        const receiverSnap = await get(ref(db, "users/" + paytm));
        if (!receiverSnap.exists()) return res.status(404).json({ status: "error", message: "User is not registered in Lion Pay!" });

        const currentReceiverBal = Number(receiverSnap.val().balance) || 0;

        const updates = {};
        updates[`users/${adminPhone}/balance`] = currentAdminBal - withdrawAmount;
        updates[`users/${paytm}/balance`] = currentReceiverBal + withdrawAmount;

        const exactDate = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        const txnId1 = "TXN" + Date.now().toString(36).toUpperCase() + "OUT";
        const txnId2 = "TXN" + Date.now().toString(36).toUpperCase() + "IN";

        // Admin & Receiver History Updates mapping Lion Pay schema
        updates[`transactions/${txnId1}`] = {
            id: txnId1, type: "out", title: "API Payment to " + paytm, amount: withdrawAmount,
            status: "Success", date: exactDate, timestamp: Date.now(), icon: "fa-code", color: "gray",
            senderId: adminPhone, receiverId: paytm
        };

        updates[`transactions/${txnId2}`] = {
            id: txnId2, type: "in", title: "API Received from " + adminPhone, amount: withdrawAmount,
            status: "Success", date: exactDate, timestamp: Date.now(), icon: "fa-arrow-down", color: "green",
            senderId: adminPhone, receiverId: paytm
        };

        await update(ref(db), updates);

        return res.status(200).json({
            status: "success",
            message: "Payment successful",
            data: { transaction_id: txnId2, amount: withdrawAmount, receiver: paytm }
        });

    } catch (error) {
        console.error("API Crash: ", error);
        return res.status(500).json({ status: "error", message: "Internal Server Error" });
    }
}
