const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

const API_KEY = "FAHKJHSKAHFKJSAHFKAHFKJAFSAKHFK";

app.use(express.json());

let database = {};
let locks = {};

// Root check
app.get('/', (req, res) => {
    res.send('Roblox API Backend is online!');
});

// Load data (GET of POST)
app.get('/loadPlayerData', (req, res) => {
    const userId = req.query.user_id;
    if (database[userId]) {
        res.json({ success: true, exists: true, data: database[userId] });
    } else {
        res.json({ success: true, exists: false });
    }
});

app.post('/player/load', (req, res) => {
    const { userId } = req.body;
    if (database[userId]) {
        res.json({ success: true, exists: true, data: database[userId] });
    } else {
        res.json({ success: true, exists: false });
    }
});

// Create data (ondersteunt zowel /player/create als /createPlayerData)
app.post(['/player/create', '/createPlayerData'], (req, res) => {
    const userId = req.body.userId || req.body.user_id;
    const data = req.body.data;
    
    if (userId) {
        database[userId] = data || {};
        res.json({ success: true });
    } else {
        res.status(400).json({ success: false, error: "Missing userId" });
    }
});

// Save data
app.post(['/player/save', '/savePlayerData'], (req, res) => {
    const userId = req.body.userId || req.body.user_id;
    const data = req.body.data;
    
    if (database[userId]) {
        database[userId] = data;
        res.json({ success: true });
    } else {
        database[userId] = data; // Aanmaken als het nog niet bestond
        res.json({ success: true });
    }
});

// Lock / Unlock data
app.post(['/player/lock', '/lockPlayerData'], (req, res) => {
    const userId = req.body.userId || req.body.user_id;
    locks[userId] = true;
    res.json({ success: true });
});

app.post(['/player/unlock', '/unlockPlayerData'], (req, res) => {
    const userId = req.body.userId || req.body.user_id;
    delete locks[userId];
    res.json({ success: true });
});

app.listen(PORT, () => {
    console.log(`Server draait op poort ${PORT}`);
});
