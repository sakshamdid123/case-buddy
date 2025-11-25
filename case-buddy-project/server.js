// server.js
const express = require('express');
const app = express();
const path = require('path');

// 1. Tell the server to parse JSON text
app.use(express.json());

// 2. Serve your 'index.html' and other files (like the 'cases' folder)
app.use(express.static(path.join(__dirname, '.')));

// --- SMART MODEL DETECTION LOGIC ---
let cachedModelName = null;

async function getBestModel(apiKey) {
    // If we already found a working model, reuse it to be fast
    if (cachedModelName) return cachedModelName;

    try {
        console.log("Auto-detecting best available Gemini model...");
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        const data = await response.json();
        
        if (!data.models) throw new Error("No models list returned from Google.");

        // Filter for models that support content generation
        const validModels = data.models.filter(m => 
            m.supportedGenerationMethods && 
            m.supportedGenerationMethods.includes("generateContent")
        );

        // Priority list: Flash -> 1.5 Pro -> 1.0 Pro -> Anything else
        const preferred = validModels.find(m => m.name.includes("gemini-1.5-flash")) ||
                          validModels.find(m => m.name.includes("gemini-1.5-pro")) ||
                          validModels.find(m => m.name.includes("gemini-pro")) ||
                          validModels[0];

        if (!preferred) throw new Error("No compatible text generation models found.");

        console.log(`Selected Model: ${preferred.name}`);
        cachedModelName = preferred.name; // Save it for next time
        return preferred.name;

    } catch (error) {
        console.error("Model detection failed:", error.message);
        // Fallback to a safe default if detection crashes
        return "models/gemini-1.5-flash";
    }
}

// 3. The Secure "Back Door" Route
app.post('/api/generate-feedback', async (req, res) => {
    const API_KEY = process.env.GEMINI_API_KEY; // Securely get key from Render

    if (!API_KEY) {
        console.error("Error: GEMINI_API_KEY is missing.");
        return res.status(500).json({ error: "Server configuration error: Missing API Key" });
    }

    try {
        // 1. Get the best model dynamically
        const modelName = await getBestModel(API_KEY);

        // 2. Construct URL using the specific model name found
        // Note: modelName usually comes as "models/gemini-1.5-flash", so we put it directly in the URL path
        const url = `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${API_KEY}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: req.body.prompt }] }] })
        });

        const data = await response.json();

        // Check for Google API Errors specifically
        if (!response.ok) {
            console.error("Google API Error:", JSON.stringify(data, null, 2));
            return res.status(response.status).json(data);
        }

        res.json(data);

    } catch (error) {
        console.error("Server Request Failed:", error);
        res.status(500).json({ error: error.message });
    }
});

// 4. Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Case Buddy running on port ${PORT}`));
