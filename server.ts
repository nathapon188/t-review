import express from "express";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { google } from "googleapis";
import path from "path";
import fs from "fs";

// Initialize express app
const app = express();
const PORT = 3000;

// Enable JSON body parsing
app.use(express.json());

// Initialize Gemini client rather than OpenAI so it works out-of-the-box
// using the securely injected GEMINI_API_KEY from AI Studio
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// OAuth Endpoints

app.get('/api/auth/url', (req, res) => {
  const redirectUri = req.query.redirectUri as string;
  if (!redirectUri) {
    return res.status(400).json({ error: 'redirectUri is required' });
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.OAUTH_CLIENT_ID,
    process.env.OAUTH_CLIENT_SECRET,
    redirectUri
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/business.manage'],
    prompt: 'consent' // Force to get refresh token
  });

  res.json({ url: authUrl });
});

// The actual callback just sends the code back to the parent window
app.get(['/auth/callback', '/auth/callback/'], (req, res) => {
  const { code } = req.query;
  res.send(`
    <html>
      <head><title>Authentication Successful</title></head>
      <body>
        <script>
          if (window.opener) {
            window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', code: '${code}' }, '*');
            window.close();
          } else {
            window.location.href = '/';
          }
        </script>
        <p>Authentication successful. This window should close automatically.</p>
      </body>
    </html>
  `);
});

// Exchange code for token
app.post('/api/auth/token', async (req, res) => {
  try {
    const { code, redirectUri } = req.body;
    if (!code || !redirectUri) {
      return res.status(400).json({ error: 'code and redirectUri are required' });
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.OAUTH_CLIENT_ID,
      process.env.OAUTH_CLIENT_SECRET,
      redirectUri
    );

    const { tokens } = await oauth2Client.getToken(code);
    res.json(tokens);
  } catch (error) {
    console.error('Token extraction error:', error);
    res.status(500).json({ error: 'Failed to exchange token' });
  }
});

// Middleware to set up oauth2Client from request token
const getAuthenticatedClient = (req: express.Request) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Missing or invalid Authorization header');
  }
  const token = authHeader.split(' ')[1];
  
  const oauth2Client = new google.auth.OAuth2(
    process.env.OAUTH_CLIENT_ID,
    process.env.OAUTH_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ access_token: token });
  return oauth2Client;
};

// GMB API proxy endpoints
app.get('/api/gmb/reviews', async (req, res) => {
  try {
    const authClient = getAuthenticatedClient(req);
    
    // 1. Get Accounts
    const accountsRes = await authClient.request({
      url: 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
    });
    const accounts = (accountsRes.data as any).accounts || [];
    if (accounts.length === 0) {
      return res.status(404).json({ error: 'No Google Business accounts found' });
    }
    
    // We'll use the first account for simplicity
    const accountName = accounts[0].name; // e.g. "accounts/12345"
    
    // 2. Get Locations for that account
    const locationsRes = await authClient.request({
      url: `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations`,
      params: {
        readMask: 'name,title'
      }
    });
    
    const locations = (locationsRes.data as any).locations || [];
    if (locations.length === 0) {
       return res.status(404).json({ error: 'No locations found under this account' });
    }
    
    // Use the first location
    const locationName = locations[0].name; // e.g. "locations/67890"
    const locationId = locationName.split('/')[1];
    
    const fullLocationPath = `${accountName}/locations/${locationId}`;
    
    // 3. Get Reviews
    const reviewsRes = await authClient.request({
      url: `https://mybusiness.googleapis.com/v1/${fullLocationPath}/reviews`,
    });
    
    const reviews = (reviewsRes.data as any).reviews || [];
    
    res.json({ 
      location: locations[0], 
      fullLocationPath, 
      reviews 
    });
  } catch (error: any) {
    console.error('Error fetching reviews:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch reviews', details: error.response?.data });
  }
});

app.post('/api/gmb/reviews/reply', async (req, res) => {
  try {
    const authClient = getAuthenticatedClient(req);
    const { reviewName, replyText } = req.body;
    
    if (!reviewName || !replyText) {
       return res.status(400).json({ error: 'reviewName and replyText required' });
    }
    
    const replyRes = await authClient.request({
      method: 'PUT',
      url: `https://mybusiness.googleapis.com/v1/${reviewName}/reply`,
      data: {
        comment: replyText
      }
    });
    
    res.json(replyRes.data);
  } catch (error: any) {
    console.error('Error posting reply:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to post reply', details: error.response?.data });
  }
});

app.post("/api/generate-review-reply", async (req, res) => {
  try {
    const { platform, reviewerName, starRating, reviewText } = req.body;

    const systemPrompt = `
You are replying on behalf of Tamrab Thai, a Thai restaurant in Brisbane.

Write a short, warm, professional reply to a customer review.

Tone:
- friendly
- genuine
- respectful
- not too formal
- not robotic
- suitable for a premium but welcoming Thai restaurant

Rules:
- thank the customer
- mention specific items or experience if they are in the review
- for negative reviews, apologize politely and acknowledge the issue
- do not argue
- do not promise anything unrealistic
- keep replies between 30 and 80 words
- use Australian English
- do not use emojis unless requested
- end naturally
`;

    const userPrompt = `
Platform: ${platform || "Google"}
Reviewer name: ${reviewerName || "Customer"}
Star rating: ${starRating}
Review: ${reviewText}
`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { text: systemPrompt + "\n\n" + userPrompt }
          ]
        }
      ]
    });

    const reply = response.text?.trim() || "";

    res.json({ reply });
  } catch (error) {
    console.error("Agentic error generating reply:", error);
    res.status(500).json({ error: "Failed to generate reply." });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    // Development mode with Vite middleware
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production mode serving static files
    const distPath = path.join(process.cwd(), "dist");
    
    // Check if dist exists (useful if started without building)
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    } else {
      app.get("*", (req, res) => {
        res.status(404).send("Production build not found. Please run 'npm run build' first.");
      });
    }
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
