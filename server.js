const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

const API_KEY = "FAHKJHSKAHFKJSAHFKAHFKJAFSAKHFK";
const DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1550868735437447388/UzUjFVHpy1Rwyfce_uqEgNUIpP7SSFGS3gzPp-q0iwEWEdwBrGw_1AZb7E3szc_PCd_o"; // Plak hier je Discord webhook link

app.use(express.json());

let database = {};
let locks = {};

// Functie om errors naar Discord te sturen
async function sendDiscordAlert(title, message) {
    if (!DISCORD_WEBHOOK_URL || DISCORD_WEBHOOK_URL.includes("JOUW_DISCORD")) return;
    
    try {
        const payload = {
            embeds: [{
                title: `🚨 VPS Error: ${title}`,
                description: `\`\`\`json\n${message}\n\`\`\``,
                color: 16711680, // Rood
                timestamp: new Date().toISOString()
            }]
        };

        await fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (err) {
        console.error("Kon geen melding naar Discord sturen:", err);
    }
}

// Root check
app.get('/', (req, res) => {
    res.send('Roblox API Backend is online!');
});

// Load data
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

// Create data
app.post(['/player/create', '/createPlayerData'], async (req, res) => {
    // We vangen nu ook req.body.player_id op!
    const userId = req.body.userId || req.body.user_id || req.body.player_id;
    const data = req.body.data || req.body; // Soms stuurt de game de data direct in de body
    
    if (userId) {
        database[userId] = data;
        res.json({ success: true });
    } else {
        await sendDiscordAlert("Create Data Failed", `Ontbrekende userId bij create request. Body: ${JSON.stringify(req.body)}`);
        res.status(400).json({ success: false, error: "Missing userId" });
    }
});

// Save data
app.post(['/player/save', '/savePlayerData'], (req, res) => {
    const userId = req.body.userId || req.body.user_id || req.body.player_id;
    const data = req.body.data || req.body;
    
    if (userId) {
        database[userId] = data;
        res.json({ success: true });
    } else {
        res.status(400).json({ success: false, error: "Missing userId" });
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
