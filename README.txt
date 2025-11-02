Cat-BOT — Carl-bot style web dashboard (JP/EN) — Free hosting ready (Render/Glitch)

SETUP
1) Copy .env.example to .env and fill TOKEN, CLIENT_ID, CLIENT_SECRET, REDIRECT_URI.
   - In Discord Developer Portal, add the REDIRECT_URI to OAuth2 > Redirects.
2) Install deps:
   npm install
3) Run locally:
   node web/app.js
4) Deploy on Render:
   - Web Service, Start command: node web/app.js
   - Add .env variables in Render dashboard.

ROUTES
- /           : Login page
- /login      : Start Discord OAuth2
- /callback   : OAuth2 callback
- /guilds     : Select a server (only ones you manage and where the bot is present)
- /dashboard/:guildId : Control panel
- /logout     : Sign out

FEATURES
- Clone Category (pick source category, enter new name)
- Clone Role (pick role, enter new name)
- Copy Permissions (pick from-channel & to-channel)
- Save Template (pick category; saves as JSON on disk)
