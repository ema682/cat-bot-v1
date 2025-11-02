import express from "express";
import session from "express-session";
import DiscordOauth2 from "discord-oauth2";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const oauth = new DiscordOauth2();

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: "catbot-secret",
    resave: false,
    saveUninitialized: false,
  })
);

// -------------------
// ルート定義
// -------------------

// トップページ → ログインへ誘導
app.get("/", (req, res) => res.redirect("/login"));

// Discord ログイン処理
app.get("/login", (req, res) => {
  const url = oauth.generateAuthUrl({
    clientId: CLIENT_ID,
    scope: ["identify", "guilds"],
    redirectUri: REDIRECT_URI,
    responseType: "code",
  });
  res.redirect(url);
});

// Discord OAuth2 コールバック処理
app.get("/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.send("Missing code");

  try {
    const token = await oauth.tokenRequest({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      code,
      scope: ["identify", "guilds"],
      grantType: "authorization_code",
      redirectUri: REDIRECT_URI,
    });

    const user = await oauth.getUser(token.access_token);
    req.session.user = user;
    console.log(`[LOGIN] ${user.username} がログインしました`);
    res.redirect("/dashboard");
  } catch (err) {
    console.error("OAuth2 error:", err);
    res.status(500).send("OAuth2 認証エラー");
  }
});

// ダッシュボード
app.get("/dashboard", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  res.render("dashboard", { user: req.session.user });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Cat-BOT running on port ${PORT}`));
