const express = require('express');
const session = require('express-session');
const app = express();
const PORT = process.env.PORT || 3000;

const API_KEY = "FAHKJHSKAHFKJSAHFKAHFKJAFSAKHFK";
const DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1550868735437447388/UzUjFVHpy1Rwyfce_uqEgNUIpP7SSFGS3gzPp-q0iwEWEdwBrGw_1AZb7E3szc_PCd_o";

// --- DISCORD OAUTH CONFIGURATIE ---
const CLIENT_ID = "1550876215592882356";
const CLIENT_SECRET = "jxZautoqlEgF2VUYDFa3XUC0ZnywCI3v";
const REDIRECT_URI = "https://scaling-lamp-jffb.onrender.com/auth/discord/callback";
const ALLOWED_ROLE_ID = "1500605095522599072";
const GUILD_ID = "1500515809380794561";

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'een-heel-geheim-wachtwoord-voor-sessies',
    resave: false,
    saveUninitialized: false
}));

let database = {};
let locks = {};

// Hulpfunctie voor Discord alerts
async function sendDiscordAlert(title, message) {
    if (!DISCORD_WEBHOOK_URL || DISCORD_WEBHOOK_URL.includes("JOUW_DISCORD")) return;
    try {
        await fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                embeds: [{ title: `🚨 VPS Alert: ${title}`, description: `\`\`\`json\n${message}\n\`\`\``, color: 16711680 }]
            })
        });
    } catch (err) {}
}

// ==================== DISCORD LOGIN ROUTES ====================

app.get('/login', (req, res) => {
    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds.members.read`;
    res.redirect(discordAuthUrl);
});

app.get('/auth/discord/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.send('Geen code ontvangen van Discord.');

    try {
        // Token aanvragen
        const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            body: new URLSearchParams({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: REDIRECT_URI,
            }),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) return res.send('Inloggen mislukt (geen access token).');

        // Check rollen van de gebruiker in de Discord server
        const memberRes = await fetch(`https://discord.com/api/users/@me/guilds/${GUILD_ID}/member`, {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const memberData = await memberRes.json();

        if (!memberRes.ok || !memberData.roles || !memberData.roles.includes(ALLOWED_ROLE_ID)) {
            return res.send('<h1>Toegang geweigerd</h1><p>Je hebt niet de juiste Discord-rol om dit paneel te bekijken.</p>');
        }

        // Sla sessie op dat gebruiker is ingelogd
        req.session.user = memberData;
        res.redirect('/panel');
    } catch (err) {
        console.error(err);
        res.send('Er is een fout opgetreden bij het inloggen.');
    }
});

// ==================== ADMIN PANEEL PAGINA ====================

app.get('/panel', (req, res) => {
    if (!req.session.user) {
        return res.send('<h1>Niet ingelogd</h1><p>Log eerst in via Discord: <a href="/login">Inloggen met Discord</a></p>');
    }

    // HTML Dashboard voor het beheer van geld/data
    res.send(`
        <html>
        <head>
            <title>Roblox Admin Paneel</title>
            <style>
                body { font-family: Arial, sans-serif; background: #121212; color: #fff; padding: 40px; }
                .card { background: #1e1e1e; padding: 20px; border-radius: 8px; margin-bottom: 20px; width: 400px; }
                input, button { padding: 10px; margin: 5px 0; width: 100%; box-sizing: border-box; }
                button { background: #5865F2; color: white; border: none; cursor: pointer; border-radius: 4px; font-weight: bold; }
                button:hover { background: #4752C4; }
            </style>
        </head>
        <body>
            <h1>🎮 Roblox Game Admin Paneel</h1>
            <p>Ingelogd als beheerder.</p>
            
            <div class="card">
                <h3>Geld / Contant aanpassen</h3>
                <form action="/admin/give-money" method="POST">
                    <label>Speler User ID:</label>
                    <input type="text" name="userId" placeholder="Bijv. 2233747337" required>
                    <label>Bedrag (positief of negatief):</label>
                    <input type="number" name="amount" placeholder="Bijv. 5000" required>
                    <button type="submit">Geld Toevoegen</button>
                </form>
            </div>
        </body>
        </html>
    `);
});

// Actie om geld te geven vanuit het paneel
app.post('/admin/give-money', (req, res) => {
    if (!req.session.user) return res.status(403).send('Niet ingelogd');

    const { userId, amount } = req.body;
    if (database[userId]) {
        // Zorg dat contant bestaat en tel het op
        database[userId].contant = (database[userId].contant || 0) + Number(amount);
        res.send(`<h1>Succes!</h1><p>Speler ${userId} heeft ${amount} extra contant gekregen.</p><p><a href="/panel">Terug naar paneel</a></p>`);
    } else {
        res.send(`<h1>Fout</h1><p>Speler met ID ${userId} is momenteel niet online in de database.</p><p><a href="/panel">Terug naar paneel</a></p>`);
    }
});

// ==================== ROBLOX API ROUTES ====================

app.get('/', (req, res) => {
    res.send('Roblox API Backend is online!');
});

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

app.post(['/player/create', '/createPlayerData'], (req, res) => {
    const userId = req.body.userId || req.body.user_id || req.body.player_id;
    const data = req.body.data || req.body;
    if (userId) {
        database[userId] = data;
        res.json({ success: true });
    } else {
        res.status(400).json({ success: false, error: "Missing userId" });
    }
});

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

app.post(['/player/lock', '/lockPlayerData'], (req, res) => {
    const userId = req.body.userId || req.body.user_id || req.body.player_id;
    locks[userId] = true;
    res.json({ success: true });
});

app.post(['/player/unlock', '/unlockPlayerData'], (req, res) => {
    const userId = req.body.userId || req.body.user_id || req.body.player_id;
    delete locks[userId];
    res.json({ success: true });
});

app.listen(PORT, () => {
    console.log(`Server draait op poort ${PORT}`);
});
