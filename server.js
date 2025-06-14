require('dotenv').config();  
const express = require('express');  
const fs = require('fs');  
const path = require('path');  
const session = require('express-session');  
  
const app = express();  
const PORT = 3000;  
const USERS_DIR = path.join(__dirname, 'data');  
const WITHDRAWAL_PATH = path.join(__dirname, 'withdrawalRequest.json');  
const WITHDRAW_MSG_PATH = path.join(__dirname, 'withdrawMessages.json');  
const ADS_PATH = path.join(__dirname, 'ads.json');  
  
// Ensure data folder exists  
if (!fs.existsSync(USERS_DIR)) fs.mkdirSync(USERS_DIR);  
if (!fs.existsSync(ADS_PATH)) fs.writeFileSync(ADS_PATH, '[]', 'utf-8');  
  
app.use(express.static(__dirname));  
app.use(express.json());  
app.use(session({  
  secret: process.env.SESSION_SECRET || 'default_secret_key',  
  resave: false,  
  saveUninitialized: true,  
  cookie: { secure: false }  
}));  
  
// Helpers  
function userFile(username) {  
  return path.join(USERS_DIR, `${username}.json`);  
}  
function loadUser(username) {  
  const f = userFile(username);  
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f,'utf-8')) : null;  
}  
function saveUser(user) {  
  fs.writeFileSync(userFile(user.username), JSON.stringify(user, null, 2));  
}  
function loadAllUsers() {  
  return fs.readdirSync(USERS_DIR)  
    .filter(f => f.endsWith('.json'))  
    .map(f => JSON.parse(fs.readFileSync(path.join(USERS_DIR, f))));  
}  
function loadWithdrawals() {  
  return fs.existsSync(WITHDRAWAL_PATH) ? JSON.parse(fs.readFileSync(WITHDRAWAL_PATH,'utf-8')) : [];  
}  
function saveWithdrawals(arr) {  
  fs.writeFileSync(WITHDRAWAL_PATH, JSON.stringify(arr, null, 2));  
}  
function loadWithdrawMessages() {  
  return fs.existsSync(WITHDRAW_MSG_PATH) ? JSON.parse(fs.readFileSync(WITHDRAW_MSG_PATH,'utf-8')) : [];  
}  
function saveWithdrawMessages(arr) {  
  fs.writeFileSync(WITHDRAW_MSG_PATH, JSON.stringify(arr, null, 2));  
}  
  
// Routes  
  
app.get('/', (req, res) => {  
  res.sendFile(path.join(__dirname, 'index.html'));  
});  
  
app.post('/api/register', (req, res) => {  
  const { username, email, password, referralCode } = req.body;  
  const users = loadAllUsers();  
  
  if (users.find(u => u.username === username || u.email === email)) {  
    return res.json({ success: false, message: "Username or email already exists." });  
  }  
  
  const referrer = users.find(u => u.referralCode === referralCode);  
  const newUser = {  
    username,  
    email,  
    id: "user_" + Date.now(),  
    role: "user",  
    banned: false,  
    password,  
    bankDetails: { bankName: "", accountName: "", accountNumber: "" },  
    points: 0,  
    referralCode: username,  
    referredBy: referrer ? referrer.username : null,  
    dateOfRegistration: new Date().toISOString(),  
    lastLogin: new Date().toISOString(),  
    ip: req.ip,  
    notifications: []  
  };  
  
  saveUser(newUser);  
  if (referrer) {  
    referrer.points = (parseFloat(referrer.points) || 0) +50 ;  
    referrer.notifications = referrer.notifications || [];  
    referrer.notifications.push({  
      from: "system",  
      message: `You earned 50 points for referring ${username}`,  
      date: new Date().toLocaleString()  
    });  
    saveUser(referrer);  
  }  
  
  res.json({ success: true });  
});  
  
app.post('/api/login', (req, res) => {  
  const { emailOrUsername, password } = req.body;  
  const users = loadAllUsers();  
  const user = users.find(u =>  
    (u.username === emailOrUsername || u.email === emailOrUsername) &&  
    u.password === password  
  );  
  if (!user) return res.json({ success: false, message: "Invalid credentials" });  
  if (user.banned) return res.json({ success: false, message: "User is banned" });  
  
  user.lastLogin = new Date().toISOString();  
  saveUser(user);  
  
  req.session.userId = user.id;  
  res.json({ success: true, username: user.username, role: user.role, id: user.id, points: parseFloat(user.points) });  
});  
  
app.get('/api/check-login', (req, res) => {  
  const uid = req.session.userId;  
  if (!uid) return res.json({ loggedIn: false });  
  const user = loadAllUsers().find(u => u.id === uid);  
  if (!user) return res.json({ loggedIn: false });  
  res.json({ loggedIn: true, username: user.username, role: user.role, id: user.id, points: parseFloat(user.points) });  
});  
  
app.post('/api/logout', (req, res) => {  
  req.session.destroy(() => res.sendStatus(200));  
});  
  
// Update bank details  
app.post('/api/update-bank', (req, res) => {  
  const { id, bankDetails } = req.body;  
  const user = loadAllUsers().find(u => u.id === id);  
  if (!user) return res.sendStatus(404);  
  user.bankDetails = bankDetails;  
  saveUser(user);  
  res.sendStatus(200);  
});  
  
// Points operations  
[['/api/users/add-points', (u, amt)=> u.points = (parseFloat(u.points)||0) + amt],  
 ['/api/users/deduct-points', (u, amt)=> u.points = Math.max(0,(parseFloat(u.points)||0)-amt)]]  
 .forEach(([route, op]) => {  
  app.post(route, (req, res) => {  
    const { id, amount } = req.body;  
    const amt = parseFloat(amount);  
    if (isNaN(amt) || amt <= 0) return res.status(400).json({ error: "Invalid user or amount" });  
    const user = loadAllUsers().find(u => u.id === id);  
    if (!user) return res.status(400).json({ error: "Invalid user or amount" });  
    op(user, amt);  
    saveUser(user);  
    res.sendStatus(200);  
  });  
});  
  
// Ban/unban  
app.post('/api/users/ban', (req,res) => {  
  const u = loadAllUsers().find(u => u.id === req.body.id);  
  if (!u) return res.sendStatus(404);  
  u.banned = true; saveUser(u); res.sendStatus(200);  
});  
app.post('/api/users/unban', (req,res) => {  
  const u = loadAllUsers().find(u => u.id === req.body.id);  
  if (!u) return res.sendStatus(404);  
  u.banned = false; saveUser(u); res.sendStatus(200);  
});  
  
// Reset password  
app.post('/api/users/reset-password', (req, res) => {  
  const { id, newPassword } = req.body;  
  if (!newPassword?.trim()) return res.status(400).json({ error: 'Invalid password' });  
  const user = loadAllUsers().find(u => u.id === id);  
  if (!user) return res.status(404).json({ error: 'User not found' });  
  user.password = newPassword.trim();  
  saveUser(user);  
  res.sendStatus(200);  
});  
  
// Update username  
app.post('/api/users/update-username', (req, res) => {  
  const { id, newUsername } = req.body;  
  const users = loadAllUsers();  
  const user = users.find(u => u.id === id);  
  if (!user) return res.status(404).json({ error: "User not found" });  
  fs.unlinkSync(userFile(user.username));  
  user.username = newUsername;  
  saveUser(user);  
  res.sendStatus(200);  
});  
  
app.get('/api/users', (req, res) => {  
  res.json(loadAllUsers());  
});  
  
// Withdrawal request  
app.post('/api/request-withdrawal', (req,res) => {  
  const { username, id, amount } = req.body;  
  const user = loadUser(username);  
  const amt = parseFloat(amount);  
  if (!user || user.id !== id) return res.status(404).json({ error: "User not found" });  
  if (isNaN(amt) || amt < 1000) return res.status(400).json({ error: "Minimum withdrawal is ₦1000.00" });  
  if ((parseFloat(user.points)||0) < amt) return res.status(400).json({ error: "Insufficient points" });  
  
  user.points = parseFloat((parseFloat(user.points)-amt).toFixed(4));  
  saveUser(user);  
  
  const arr = loadWithdrawals();  
  arr.push({ username, id, date: new Date().toISOString(), amount: amt.toFixed(4) });  
  saveWithdrawals(arr);  
  res.sendStatus(200);  
});  
  
// Get withdrawals  
app.get('/api/withdrawals', (req, res) => {  
  const wr = loadWithdrawals();  
  const merged = wr.map(w => {  
    const u = loadAllUsers().find(u => u.id === w.id);  
    return { ...w, bankDetails: u ? u.bankDetails : {} };  
  });  
  res.json(merged);  
});  
  
// Confirm or decline withdrawal  
[['/api/withdrawals/confirm', true], ['/api/withdrawals/decline', false]].forEach(([route, isConfirm]) => {  
  app.post(route, (req, res) => {  
    const { requestId } = req.body;  
    let arr = loadWithdrawals();  
    const w = arr.find(w => w.id === requestId);  
    if (!w) return res.status(404).json({ error: "Withdrawal request not found" });  
  
    arr = arr.filter(x => x.id !== requestId);  
    saveWithdrawals(arr);  
  
    if (!isConfirm) { // refund points  
      const user = loadAllUsers().find(u => u.id === w.id);  
      if (user) {  
        user.points = (parseFloat(user.points)||0) + parseFloat(w.amount);  
        saveUser(user);  
      }  
    }  
  
    const msgArr = loadWithdrawMessages();  
    const msg = isConfirm  
      ? `Dear ${w.username}, your withdrawal request of ₦${w.amount} was confirmed. Thank you.`  
      : `Dear ${w.username}, your withdrawal request of ₦${w.amount} was declined. Points refunded to your account.`;  
    msgArr.push({ username: w.username, message: msg, date: new Date().toISOString() });  
    saveWithdrawMessages(msgArr);  
  
    res.json({ success: true, message: isConfirm ? "Withdrawal confirmed and user notified." : "Withdrawal declined and points refunded to user." });  
  });  
});  
  
// Messages & notifications  
app.post('/api/messages', (req, res) => {  
  const { target, username, usernames, message } = req.body;  
  const users = loadAllUsers();  
  const now = new Date().toLocaleString();  
  
  users.forEach(user => {  
    const send = target === 'all' ||  
      user.username === username ||  
      (Array.isArray(usernames) && usernames.includes(user.username));  
  
    if (send) {  
      user.notifications = user.notifications || [];  
      user.notifications.push({ message, date: now, from: "admin" });  
      saveUser(user);  
    }  
  });  
  res.sendStatus(200);  
});  
  
app.get('/api/user/:username', (req, res) => {  
  const u = loadUser(req.params.username);  
  return u ? res.json(u) : res.status(404).json({ error: "User not found" });  
});  
  
app.post('/api/clear-notifications', (req, res) => {  
  const { username } = req.body;  
  const u = loadUser(username);  
  if (!u) return res.status(404).json({ error: "User not found" });  
  u.notifications = [];  
  saveUser(u);  
  res.sendStatus(200);  
});  
  
app.get('/api/withdrawMessages', (req, res) => {  
  res.json(loadWithdrawMessages());  
});  
  
app.get('/api/user-withdraw-messages', (req,res) => {  
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });  
  const u = loadAllUsers().find(u => u.id === req.session.userId);  
  if (!u) return res.status(404).json({ error: 'User not found' });  
  const msgs = loadWithdrawMessages().filter(m => m.username === u.username);  
  res.json(msgs);  
});  
  
app.get('/api/user-admin-messages', (req,res) => {  
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });  
  const u = loadAllUsers().find(u => u.id === req.session.userId);  
  if (!u) return res.status(404).json({ error: 'User not found' });  
  res.json((u.notifications||[]).filter(n => n.from === 'admin'));  
});  
  
app.get('/api/user-referral-messages', (req,res) => {  
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });  
  const u = loadAllUsers().find(u => u.id === req.session.userId);  
  if (!u) return res.status(404).json({ error: 'User not found' });  
  res.json((u.notifications||[]).filter(n => n.message.includes("earned 50 points for referring")));  
});  
  
// Ads endpoints  
app.get('/api/ads', (req, res) => {  
  res.json(JSON.parse(fs.readFileSync(ADS_PATH,'utf-8')));  
});  
app.post('/api/ads', (req,res) => {  
  const arr = JSON.parse(fs.readFileSync(ADS_PATH,'utf-8'));  
  arr.push(req.body);  
  fs.writeFileSync(ADS_PATH, JSON.stringify(arr, null, 2));  
  res.sendStatus(200);  
});  
app.delete('/api/ads/:index', (req,res) => {  
  const arr = JSON.parse(fs.readFileSync(ADS_PATH,'utf-8'));  
  arr.splice(Number(req.params.index), 1);  
  fs.writeFileSync(ADS_PATH, JSON.stringify(arr, null, 2));  
  res.sendStatus(200);  
});  
  
app.listen(PORT, () => {  
  console.log(`Server running on http://localhost:${PORT}`);  
});  
