const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

const API_KEY = "FAHKJHSKAHFKJSAHFKAHFKJAFSAKHFK"; // Je API key

app.use(express.json());

let database = {};
let locks = {};

// Root check voor status
app.get('/', (req, res) => {
    res.send('Roblox API Backend is online!');
});

// Ondersteuning voor loadPlayerData (zowel GET als POST voor de zekerheid)
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

app.post('/player/create', (req, res) => {
    const { userId, data } = req.body;
    database[userId] = data;
    res.json({ success: true });
});

app.post('/player/save', (req, res) => {
    const { userId, data } = req.body;
    database[userId] = data;
    res.json({ success: true });
});

app.post('/player/lock', (req, res) => {
    const { userId } = req.body;
    locks[userId] = true;
    res.json({ success: true });
});

app.post('/player/unlock', (req, res) => {
    const { userId } = req.body;
    delete locks[userId];
    res.json({ success: true });
});

app.listen(PORT, () => {
    console.log(`Server draait op poort ${PORT}`);
});
