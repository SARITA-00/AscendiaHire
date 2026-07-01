console.log("Starting Ascendia Hire server...");
require("dotenv").config();

const express      = require("express");
const http         = require("http");
const { Server }   = require("socket.io");
const path         = require("path");
const fs           = require("fs");
const xml2js       = require("xml2js");
const helmet       = require("helmet");
const rateLimit    = require("express-rate-limit");

const signupController = require("./auth/signup");
const loginController  = require("./auth/login");
const profile          = require("./profile/profile");
const startupRoutes    = require("./startup/startup");
const jobsRoutes       = require("./jobs/jobs");

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// CORS
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
});

// Rate limiting — protects auth & AI-match endpoints from abuse
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
const apiLimiter  = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });
app.use(["/login", "/signup"], authLimiter);
app.use("/jobs", apiLimiter);

if (!process.env.ANTHROPIC_API_KEY) {
    console.log("ℹ️  ANTHROPIC_API_KEY not set — AI skill matching will use the local fallback scorer.");
}

// Serve frontend
app.use(express.static(path.join(__dirname, "../frontend")));

// AUTH
app.post("/signup", signupController.signup);
app.post("/login",  loginController.login);

// PROFILE
app.post("/profile/create",          profile.createProfile);
app.get("/profile/:email",           profile.getProfile);
app.put("/profile/update/:email",    profile.updateProfile);
app.post("/profile/add-skill",       profile.addSkill);
app.post("/profile/delete-skill",    profile.deleteSkill);
app.get("/profiles",                 profile.getAllProfiles);
app.get("/profile/search/:skill",    profile.searchBySkill);
app.delete("/profile/:email",        profile.deleteProfile);
app.delete("/account/:email",        profile.deleteAccount);

// STARTUP & JOBS
app.use("/startup", startupRoutes);
app.use("/jobs",    jobsRoutes);

// SPA fallback
app.get(/(.*)/, (req, res) => {
    res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

// ── Socket.IO — Real-time startup chat ───────────────────────────────────────
const startupFile = path.join(__dirname, "database/startups.xml");
const builder     = new xml2js.Builder();

function readStartups(cb) {
    fs.readFile(startupFile, "utf8", (err, data) => {
        if (err) return cb(err);
        const parser = new xml2js.Parser({ explicitArray: true });
        parser.parseString(data, (err, result) => {
            if (err) return cb(err);
            if (!result?.startups) result = { startups: { startup: [] } };
            if (!Array.isArray(result.startups.startup)) result.startups.startup = [];
            cb(null, result);
        });
    });
}

function writeStartups(data, cb) {
    fs.writeFile(startupFile, builder.buildObject(data), cb);
}

function getMembers(startup) {
    return startup?.team?.[0]?.member || [];
}

io.on("connection", (socket) => {
    console.log("Socket connected:", socket.id);

    // Client joins a startup chat room
    socket.on("joinRoom", ({ startupId }) => {
        // Leave any previous startup room
        [...socket.rooms].forEach(r => { if (r !== socket.id) socket.leave(r); });
        socket.join("startup:" + startupId);
        console.log(`Socket ${socket.id} → startup:${startupId}`);
    });

    // Client sends a message
    socket.on("sendMessage", ({ startupId, email, text }) => {
        if (!startupId || !email || !text?.trim()) return;

        readStartups((err, data) => {
            if (err) { console.error("Read error:", err); return; }

            const startup = data.startups.startup.find(s => s.id?.[0] === startupId);
            if (!startup) return;
            if (!getMembers(startup).includes(email)) return;

            if (!startup.messages)              startup.messages = [{ message: [] }];
            if (!startup.messages[0].message)   startup.messages[0].message = [];

            const ts = Date.now();
            startup.messages[0].message.push({
                author: [email],
                text:   [text.trim()],
                ts:     [ts.toString()]
            });

            writeStartups(data, () => {
                // Broadcast to everyone in this startup room (including sender)
                io.to("startup:" + startupId).emit("newMessage", {
                    author: email,
                    text:   text.trim(),
                    ts
                });
            });
        });
    });

    socket.on("disconnect", () => {
        console.log("Socket disconnected:", socket.id);
    });
});

// ── Start ────────────────────────────────────────────────────────────────────
server.listen(3000, () => {
    console.log("✅  Ascendia Hire → http://localhost:3000");
});
