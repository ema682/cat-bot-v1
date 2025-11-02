require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const DiscordOauth2 = require('discord-oauth2');
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');

// --- Discord Bot (same process for free hosting) ---
const bot = new Client({ intents: [GatewayIntentBits.Guilds] });
bot.once('ready', () => console.log('✅ Bot ready as', bot.user.tag));
bot.login(process.env.TOKEN);

// --- Web App ---
const app = express();
const oauth = new DiscordOauth2();

app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'cat-bot-secret',
  resave: false,
  saveUninitialized: false
}));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- i18n (very lightweight) ---
const locales = {
  en: JSON.parse(fs.readFileSync(path.join(__dirname, 'locales/en.json'))),
  ja: JSON.parse(fs.readFileSync(path.join(__dirname, 'locales/ja.json')))
};
function i18n(req, res, next) {
  const q = (req.query.lang || '').toLowerCase();
  if (q === 'ja' || q === 'en') req.session.lang = q;
  const lang = req.session.lang || 'ja';
  req.t = (k) => locales[lang][k] || k;
  res.locals.t = req.t;
  res.locals.user = req.session.user;
  next();
}
app.use(i18n);

// --- Auth helpers ---
function authRequired(req, res, next) {
  if (!req.session.user || !req.session.token) return res.redirect('/');
  next();
}
function hasManageServer(g) {
  // permission bit 0x20 (32) Manage Guild
  return (g.owner || (g.permissions & 0x20) === 0x20);
}

// --- Routes ---
app.get('/', (req, res) => {
  res.render('login', { t: req.t });
});

app.get('/login', (req, res) => {
  const url = oauth.generateAuthUrl({
    clientId: process.env.CLIENT_ID,
    scope: ['identify', 'guilds'],
    redirectUri: process.env.REDIRECT_URI,
    responseType: 'code',
    prompt: 'none'
  });
  res.redirect(url);
});

app.get('/callback', async (req, res) => {
  try {
    const token = await oauth.tokenRequest({
      clientId: process.env.CLIENT_ID,
      clientSecret: process.env.CLIENT_SECRET,
      code: req.query.code,
      scope: ['identify', 'guilds'],
      grantType: 'authorization_code',
      redirectUri: process.env.REDIRECT_URI,
    });
    const user = await oauth.getUser(token.access_token);
    const guilds = await oauth.getUserGuilds(token.access_token);
    req.session.user = user;
    req.session.token = token;
    req.session.guilds = guilds;
    res.redirect('/guilds');
  } catch (e) {
    console.error(e);
    res.status(500).send('OAuth2 Error');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.get('/guilds', authRequired, (req, res) => {
  const guildsManaged = (req.session.guilds || []).filter(hasManageServer);
  const guildsBotIsIn = guildsManaged.filter(g => bot.guilds.cache.has(g.id));
  res.render('guilds', { guilds: guildsBotIsIn, t: req.t });
});

app.get('/dashboard/:id', authRequired, async (req, res) => {
  const gid = req.params.id;
  const guild = bot.guilds.cache.get(gid);
  if (!guild) return res.redirect('/guilds');

  await guild.channels.fetch();
  await guild.roles.fetch();

  const categories = guild.channels.cache
    .filter(c => c.type === ChannelType.GuildCategory)
    .map(c => ({ id: c.id, name: c.name }));

  const channels = guild.channels.cache
    .filter(c => c.type === ChannelType.GuildText || c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildAnnouncement)
    .map(c => ({ id: c.id, name: c.name, type: c.type }));

  const roles = guild.roles.cache
    .filter(r => !r.managed && r.name !== '@everyone')
    .map(r => ({ id: r.id, name: r.name }));

  const flash = req.session.flash; delete req.session.flash;
  res.render('dashboard', { guild, categories, channels, roles, flash, t: req.t });
});

// ---- Actions ----
app.post('/action/clonecategory', authRequired, async (req, res) => {
  try {
    const { guildId, categoryId, newName } = req.body;
    const guild = bot.guilds.cache.get(guildId);
    const src = guild.channels.cache.get(categoryId);
    const newCat = await guild.channels.create({ name: newName, type: ChannelType.GuildCategory, position: src.rawPosition + 1 });
    const children = guild.channels.cache.filter(c => c.parentId === src.id);
    for (const ch of children.values()) {
      await guild.channels.create({
        name: ch.name,
        type: ch.type,
        parent: newCat.id,
        topic: ch.topic || null,
        nsfw: ch.nsfw,
        rateLimitPerUser: ch.rateLimitPerUser,
        permissionOverwrites: ch.permissionOverwrites.cache.map(po => ({
          id: po.id, allow: po.allow.bitfield, deny: po.deny.bitfield
        })),
      });
    }
    req.session.flash = `Cloned category "${src.name}" → "${newCat.name}"`;
  } catch (e) {
    console.error(e);
    req.session.flash = 'Error while cloning category.';
  }
  res.redirect('back');
});

app.post('/action/clonerole', authRequired, async (req, res) => {
  try {
    const { guildId, roleId, newName } = req.body;
    const guild = bot.guilds.cache.get(guildId);
    const role = guild.roles.cache.get(roleId);
    const newRole = await guild.roles.create({
      name: newName,
      color: role.color,
      hoist: role.hoist,
      permissions: role.permissions,
      mentionable: role.mentionable
    });
    req.session.flash = `Cloned role "${role.name}" → "${newRole.name}"`;
  } catch (e) {
    console.error(e);
    req.session.flash = 'Error while cloning role.';
  }
  res.redirect('back');
});

app.post('/action/copyperms', authRequired, async (req, res) => {
  try {
    const { guildId, fromId, toId } = req.body;
    const guild = bot.guilds.cache.get(guildId);
    const from = guild.channels.cache.get(fromId);
    const to = guild.channels.cache.get(toId);
    await to.permissionOverwrites.set(from.permissionOverwrites.cache.map(po => ({
      id: po.id, allow: po.allow.bitfield, deny: po.deny.bitfield
    })));
    req.session.flash = `Copied permissions from "${from.name}" to "${to.name}"`;
  } catch (e) {
    console.error(e);
    req.session.flash = 'Error while copying permissions.';
  }
  res.redirect('back');
});

app.post('/action/templatelist', authRequired, async (req, res) => {
  try {
    const { guildId, categoryId } = req.body;
    const guild = bot.guilds.cache.get(guildId);
    const cat = guild.channels.cache.get(categoryId);
    const children = guild.channels.cache.filter(c => c.parentId === cat.id);
    const template = {
      guildId,
      category: cat.name,
      channels: children.map(ch => ({
        name: ch.name,
        type: ch.type,
        topic: ch.topic || null,
        nsfw: ch.nsfw,
        rateLimitPerUser: ch.rateLimitPerUser
      }))
    };
    const dir = path.join(process.cwd(), 'templates');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${cat.name}.json`), JSON.stringify(template, null, 2));
    req.session.flash = `Saved template "${cat.name}.json"`;
  } catch (e) {
    console.error(e);
    req.session.flash = 'Error while saving template.';
  }
  res.redirect('back');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('🌐 Web ready on :' + PORT));
