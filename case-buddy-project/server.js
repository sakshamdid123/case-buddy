// server.js
const express = require('express');
const app = express();
const path = require('path');

// 1. Tell the server to parse JSON text
app.use(express.json());

// 2. Serve your 'index.html' and other files (like the 'cases' folder)
app.use(express.static(path.join(__dirname, '.')));

// 3. The Secure "Back Door" Route
app.post('/api/generate-feedback', async (req, res) => {
    const API_KEY = process.env.GEMINI_API_KEY; // Securely get key from Render

    if (!API_KEY) return res.status(500).json({ error: "Server missing API Key" });

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: req.body.prompt }] }] })
        });

        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 4. Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Case Buddy running on port ${PORT}`));
