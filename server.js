const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Je geheime API key (dezelfde die je in Roblox in je Config zet)
const API_KEY = "FAHKJHSKAHFKJSAHFKAHFKJAFSAKHFK";

app.use(express.json());

// Simpele database in het geheugen (voor productie kun je dit vervangen door MongoDB of MySQL)
let database = {};
let locks = {};

// Middleware om de API key te controleren
const checkAuth = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (authHeader === `Bearer ${API_KEY}`) {
        next();
    } else {
        res.status(403).json({ success: false, error: "Unauthorized" });
    }
};

// 1. Data inladen / bestaan checken
app.post('/player/load', checkAuth, (req, res) => {
    const { userId } = req.body;
    if (database[userId]) {
        res.json({ success: true, exists: true, data: database[userId] });
    } else {
        res.json({ success: true, exists: false });
    }
});

// 2. Data aanmaken
app.post('/player/create', checkAuth, (req, res) => {
    const { userId, data } = req.body;
    database[userId] = data;
    res.json({ success: true });
});

// 3. Data opslaan
app.post('/player/save', checkAuth, (req, res) => {
    const { userId, data } = req.body;
    if (database[userId]) {
        database[userId] = data;
        res.json({ success: true });
    } else {
        res.json({ success: false, error: "Data not found" });
    }
});

// 4. Data locken (voorkom dubbele logins)
app.post('/player/lock', checkAuth, (req, res) => {
    const { userId } = req.body;
    if (locks[userId]) {
        res.json({ success: false, error: "Already locked" });
    } else {
        locks[userId] = true;
        res.json({ success: true });
    }
});

app.post('/player/unlock', checkAuth, (req, res) => {
    const { userId } = req.body;
    delete locks[userId];
    res.json({ success: true });
});

app.listen(PORT, () => {
    console.log(`Server draait op poort ${PORT}`);
});
