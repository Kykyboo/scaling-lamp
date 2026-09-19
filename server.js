const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(express.json());

const DB_FILE = path.join(__dirname, 'database.json');
const API_KEY = "FAHKJHSKAHFKJSAHFKAHFKJAFSAKHFK"; // Dezelfde key als in Roblox

// Hulpfunctie om database in te lezen
function readDB() {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify({}));
    }
    try {
        const data = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return {};
    }
}

// Hulpfunctie om database op te slaan
function writeDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// Middleware voor API Key beveiliging met extra debug logging
app.use((req, res, next) => {
    const receivedKey = req.headers['x-api-key'];
    
    // Print dit in je Render logs zodat je kunt zien wat Roblox meestuurt
    console.log(`[AUTH CHECK] Ontvangen API-key: "${receivedKey}"`);

    if (receivedKey !== API_KEY) {
        return res.status(403).json({ 
            error: "Geen toegang: Ongeldige API Key", 
            ontvangen: receivedKey 
        });
    }
    next();
});

// Root check
app.get('/', (req, res) => {
    res.send("API draait zonder MySQL en is succesvol verbonden!");
});

// Speler aanmaken / updaten (POST)
app.post('/player/create', (req, res) => {
    const { userId, data } = req.body;
    if (!userId) {
        return res.status(400).json({ error: "userId is verplicht" });
    }

    let db = readDB();
    db[userId] = {
        ...(db[userId] || {}),
        ...data,
        lastUpdated: new Date().toISOString()
    };
    writeDB(db);

    console.log(`[DATA OPGESLAGEN] Speler ${userId} succesvol bijgewerkt.`);
    res.json({ success: true, message: "Data succesvol opgeslagen!" });
});

// Speler opvragen (GET)
app.get('/player/get', (req, res) => {
    const userId = req.query.userId;
    if (!userId) {
        return res.status(400).json({ error: "userId query parameter ontbreekt" });
    }

    let db = readDB();
    if (db[userId]) {
        res.json(db[userId]);
    } else {
        res.status(404).json({ error: "Speler niet gevonden" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server draait op poort ${PORT} zonder MySQL.`);
});
