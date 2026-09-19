const express = require('express');
const session = require('express-session');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Laad configuratie uit config.json
const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));

// MySQL Database Verbinding
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'roblox_vps',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'een-heel-geheim-wachtwoord-voor-sessies',
    resave: false,
    saveUninitialized: false
}));

// Stel de public map in zodat statische bestanden (html, afbeeldingen) bereikbaar zijn
app.use(express.static(path.join(__dirname, 'public')));

// Automatisch tabel aanmaken bij opstarten
async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS players (
                user_id VARCHAR(64) PRIMARY KEY,
                data JSON,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        console.log(`✅ MySQL Database succesvol verbonden. [TestMode: ${config.testMode ? 'AAN 🟡' : 'UIT 🟢'}]`);
    } catch (err) {
        console.error("❌ MySQL Fout bij opstarten:", err);
    }
}
initDB();

// Webhookmeldingen in de stijl met JSON codeblock
async function sendDiscordWebhook(title, description, color = 15158332) {
    if (!config.discord.webhookUrl || config.discord.webhookUrl.includes("JOUW_DISCORD")) return;
    try {
        await fetch(config.discord.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                embeds: [{
                    title: title,
                    description: "```json\n" + description + "\n```",
                    color: color,
                    timestamp: new Date().toISOString()
                }]
            })
        });
    } catch (err) {
        console.error("Fout bij versturen Discord webhook:", err);
    }
}

// ==================== AUTHENTICATIE ROUTES ====================

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login', 'index.html'));
});

app.get('/auth/discord/url', (req, res) => {
    const discordUrl = `https://discord.com/api/oauth2/authorize?client_id=${config.discord.clientId}&redirect_uri=${encodeURIComponent(config.discord.redirectUri)}&response_type=code&scope=identify%20guilds.members.read`;
    res.json({ url: discordUrl });
});

app.get('/auth/discord/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.redirect('/login');

    try {
        const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            body: new URLSearchParams({
                client_id: config.discord.clientId,
                client_secret: config.discord.clientSecret,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: config.discord.redirectUri,
            }),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) return res.redirect('/login');

        const memberRes = await fetch(`https://discord.com/api/users/@me/guilds/${config.discord.guildId}/member`, {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const memberData = await memberRes.json();

        if (!config.testMode && (!memberRes.ok || !memberData.roles || !memberData.roles.includes(config.discord.allowedRoleId))) {
            return res.send(`
                <body style="background:#0f0f13;color:#fff;font-family:sans-serif;text-align:center;padding-top:100px;">
                    <h1 style="color:#ff5555;">Toegang geweigerd</h1>
                    <p>Je hebt niet de vereiste Discord-rol om dit paneel te bekijken.</p>
                    <a href="/login" style="color:#5865F2;">Terug naar login</a>
                </body>
            `);
        }

        const userRes = await fetch('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const userData = await userRes.json();
        memberData.username = userData.username;

        req.session.user = memberData;
        res.redirect('/panel');
    } catch (err) {
        console.error(err);
        res.send('Er is een fout opgetreden bij de authenticatie.');
    }
});

// ==================== PANEL & SPELER BEHEER ROUTES ====================

app.get('/panel', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    res.sendFile(path.join(__dirname, 'public', 'panel', 'index.html'));
});

// API endpoint om spelerslijst op te halen voor de panel pagina
app.get('/api/players', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Niet ingelogd" });
    try {
        const [rows] = await pool.query('SELECT user_id, data, updated_at FROM players ORDER BY updated_at DESC');
        res.json({ success: true, players: rows, user: req.session.user, testMode: config.testMode });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Specifieke speler data ophalen via API
app.get('/api/player/:userId', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Niet ingelogd" });
    const userId = req.params.userId;
    try {
        const [rows] = await pool.query('SELECT * FROM players WHERE user_id = ?', [userId]);
        if (rows.length === 0) return res.status(404).json({ error: "Speler niet gevonden" });
        res.json({ success: true, player: rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Losse notificatie sturen via API
app.post('/api/player/:userId/notify', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Niet ingelogd" });
    const userId = req.params.userId;
    const { message } = req.body;
    const adminName = req.session.user.username || 'Admin';

    try {
        const [rows] = await pool.query('SELECT * FROM players WHERE user_id = ?', [userId]);
        if (rows.length === 0) return res.status(404).json({ error: "Speler niet gevonden" });

        let d = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
        d.pendingNotification = `[Admin ${adminName}]: ${message}`;

        await pool.query('UPDATE players SET data = ? WHERE user_id = ?', [JSON.stringify(d), userId]);

        await sendDiscordWebhook(
            "📢 Admin Melding Verstuurd",
            JSON.stringify({ admin: adminName, target_user: userId, bericht: message }, null, 2),
            3447003
        );

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Geld aanpassen via API
app.post('/api/player/:userId/modify', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Niet ingelogd" });
    const userId = req.params.userId;
    const { type, amount, action } = req.body;
    const numAmount = parseInt(amount) || 0;
    const adminName = req.session.user.username || 'Admin';

    try {
        const [rows] = await pool.query('SELECT * FROM players WHERE user_id = ?', [userId]);
        if (rows.length === 0) return res.status(404).json({ error: "Speler niet gevonden" });

        let d = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;

        if (!d[type]) d[type] = 0;
        const actieTekst = action === 'add' ? 'ontvangen' : 'afgeschreven';
        
        if (action === 'add') {
            d[type] += numAmount;
        } else if (action === 'remove') {
            d[type] = Math.max(0, d[type] - numAmount);
        }

        d.pendingNotification = `Admin ${adminName} heeft €${numAmount} (${type}) ${actieTekst}. Nieuw saldo: €${d[type]}`;

        await pool.query('UPDATE players SET data = ? WHERE user_id = ?', [JSON.stringify(d), userId]);

        await sendDiscordWebhook(
            "💵 Geld Transactie Uitgevoerd",
            JSON.stringify({ admin: adminName, target_user: userId, type: type, actie: action, bedrag: numAmount, nieuw_totaal: d[type] }, null, 2),
            15844367
        );

        res.json({ success: true, data: d });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==================== ROBLOX API ROUTES ====================

app.get('/loadPlayerData', async (req, res) => {
    const userId = req.query.user_id;
    try {
        const [rows] = await pool.query('SELECT data FROM players WHERE user_id = ?', [userId]);
        if (rows.length > 0) {
            let d = JSON.parse(rows[0].data);
            const notification = d.pendingNotification || null;

            if (notification) {
                delete d.pendingNotification;
                await pool.query('UPDATE players SET data = ? WHERE user_id = ?', [JSON.stringify(d), userId]);
            }

            res.json({ success: true, exists: true, data: d, notification: notification });
        } else {
            res.json({ success: true, exists: false });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post(['/player/create', '/createPlayerData'], async (req, res) => {
    const userId = req.body.userId || req.body.user_id || req.body.player_id;
    const data = req.body.data || req.body;
    
    if (!userId) {
        await sendDiscordWebhook(
            "🚨 VPS Error: Create Data Failed",
            JSON.stringify({ error: "Ontbrekende userId bij create request", body: req.body }, null, 2),
            15158332
        );
        return res.status(400).json({ success: false, error: "Missing userId" });
    }

    try {
        const [existing] = await pool.query('SELECT user_id FROM players WHERE user_id = ?', [userId]);
        const isNewPlayer = existing.length === 0;

        await pool.query(
            'INSERT INTO players (user_id, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = ?',
            [userId, JSON.stringify(data), JSON.stringify(data)]
        );

        if (isNewPlayer) {
            await sendDiscordWebhook(
                "🎉 Nieuwe Speler Geregistreerd",
                JSON.stringify({ user_id: userId, status: "Aangemaakt in database" }, null, 2),
                3066993
            );
        }

        res.json({ success: true });
    } catch (err) {
        await sendDiscordWebhook("❌ MySQL Create Error", JSON.stringify({ error: err.message }, null, 2), 15158332);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post(['/player/save', '/savePlayerData'], async (req, res) => {
    const userId = req.body.userId || req.body.user_id || req.body.player_id;
    const data = req.body.data || req.body;

    if (!userId) return res.status(400).json({ success: false, error: "Missing userId" });

    try {
        await pool.query(
            'INSERT INTO players (user_id, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = ?',
            [userId, JSON.stringify(data), JSON.stringify(data)]
        );
        res.json({ success: true });
    } catch (err) {
        await sendDiscordWebhook("❌ MySQL Save Error", JSON.stringify({ error: err.message }, null, 2), 15158332);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server draait op poort ${PORT}`);
});
