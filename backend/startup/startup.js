const express = require("express");
const fs = require("fs");
const xml2js = require("xml2js");
const path = require("path");

const router = express.Router();

const filePath = path.join(__dirname, "../database/startups.xml");

const builder = new xml2js.Builder();


// ================= READ =================
function readData(callback) {
    fs.readFile(filePath, "utf8", (err, data) => {

        if (err) return callback(err);

        // Fresh parser per call — xml2js parsers are stateful and must not
        // be reused across calls. explicitArray: true prevents xml2js from
        // collapsing a single <member> or <skill> child into a plain string.
        const parser = new xml2js.Parser({ explicitArray: true });

        parser.parseString(data, (err, result) => {

            if (err) return callback(err);

            if (!result || typeof result !== 'object' || !result.startups) {
                result = { startups: { startup: [] } };
            }

            if (!Array.isArray(result.startups.startup)) {
                result.startups.startup = [];
            }

            callback(null, result);
        });
    });
}


// ================= WRITE =================
function writeData(data, callback) {
    const xml = builder.buildObject(data);
    fs.writeFile(filePath, xml, callback);
}

function getMembers(startup) {
    return startup.team?.[0]?.member || [];
}


// ================= POST STARTUP =================
router.post("/post", (req, res) => {

    const { title, description, email, skills } = req.body;

    // skills should be array: ["React", "Node"]

    readData((err, data) => {

        const newStartup = {
            id: [Date.now().toString()],
            title: [title],
            description: [description || ""],
            creator: [email],

            requiredSkills: [{
                skill: skills || []   // 🔥 NEW
            }],

            team: [{
                member: [email]
            }]
        };

        data.startups.startup.push(newStartup);

        writeData(data, () => {
            res.json({ message: "Startup posted successfully" });
        });

    });

});


// ================= GET ALL =================
router.get("/all", (req, res) => {

    readData((err, data) => {

        if (err) {
            return res.status(500).json({ message: "Database read error" });
        }

        res.json(data.startups.startup);
    });

});


// ================= JOIN STARTUP =================
router.post("/join", (req, res) => {

    const { startupId, email } = req.body; // 🔥 FIXED

    readData((err, data) => {

        if (err) {
            return res.status(500).json({ message: "Database read error" });
        }

        const startup = data.startups.startup.find(
            s => s.id[0] === startupId
        );

        if (!startup) {
            return res.json({ message: "Startup not found" });
        }

        if (!startup.team) {
            startup.team = [{ member: [] }];
        }

        if (!startup.team[0].member) {
            startup.team[0].member = [];
        }

        if (startup.team[0].member.includes(email)) {
            return res.json({ message: "Already a member" });
        }

        startup.team[0].member.push(email);

        writeData(data, () => {
            res.json({ message: "Joined startup successfully" });
        });

    });

});


// ================= LEAVE STARTUP =================
router.post("/leave", (req, res) => {

    const { startupId, email } = req.body;

    readData((err, data) => {

        if (err) {
            return res.status(500).json({ message: "Database read error" });
        }

        const startup = data.startups.startup.find(
            s => s.id?.[0] === startupId
        );

        if (!startup) {
            return res.status(404).json({ message: "Startup not found" });
        }

        const creator = startup.creator?.[0] || "";

        if (creator === email) {
            return res.status(400).json({ message: "Owner cannot leave the startup. Delete it instead." });
        }

        const members = getMembers(startup);
        const memberIndex = members.indexOf(email);

        if (memberIndex === -1) {
            return res.status(400).json({ message: "You are not a member of this startup" });
        }

        members.splice(memberIndex, 1);

        writeData(data, () => {
            res.json({ message: "Left startup successfully" });
        });

    });

});


// ================= TEAM MEMBERS =================
router.get("/team/:id", (req, res) => {

    const startupId = req.params.id;

    readData((err, data) => {

        if (err) {
            return res.status(500).json({ message: "Database read error" });
        }

        const startup = data.startups.startup.find(
            s => s.id[0] === startupId
        );

        if (!startup) {
            return res.json({ message: "Startup not found" });
        }

        const members =
            startup.team?.[0]?.member || [];

        res.json({
            startupId,
            members
        });

    });

});


// ================= DELETE STARTUP =================
router.delete("/delete/:id", (req, res) => {

    const startupId = req.params.id;
    const email = req.query.email;

    readData((err, data) => {

        if (err) {
            return res.status(500).json({ message: "Database read error" });
        }

        const startups = data.startups.startup;

        const index = startups.findIndex(
            s => s.id[0] === startupId
        );

        if (index === -1) {
            return res.json({ message: "Startup not found" });
        }

        const startup = startups[index];
        const creator = startup.creator?.[0] || "";

        if (!email) {
            return res.status(400).json({ message: "Owner email is required" });
        }

        if (creator !== email) {
            return res.status(403).json({ message: "Only the owner can delete this startup" });
        }

        startups.splice(index, 1);

        writeData(data, () => {
            res.json({ message: "Deleted successfully" });
        });

    });

});


// ================= SKILL GAP FEATURE =================
router.get("/skill-gap/:email/:startupId", (req, res) => {

    const { email, startupId } = req.params;

    const profileFile = path.join(__dirname, "../database/profiles.xml");

    fs.readFile(profileFile, "utf8", (err, pdata) => {

        if (err) return res.json({ message: "Profile read error" });

        xml2js.parseString(pdata, (err, presult) => {

            const profiles = presult.profiles.profile;
            const profile = profiles.find(p => p.email[0] === email);

            if (!profile) {
                return res.json({ message: "Profile not found" });
            }

            const userSkills = profile.skills?.[0]?.skill || [];

            readData((err, sdata) => {

                const startup = sdata.startups.startup.find(
                    s => s.id[0] === startupId
                );

                if (!startup) {
                    return res.json({ message: "Startup not found" });
                }

                // ⚠️ using description as required skills (your design)
                const required =
                    startup.requiredSkills?.[0]?.skill || [];

                const normalize = s => s.trim().toLowerCase();
                const userSkillsNorm = userSkills.map(normalize);
                const missing = required.filter(
                    skill => !userSkillsNorm.includes(normalize(skill))
                );

                res.json({
                    userSkills,
                    required,
                    missing
                });

            });

        });

    });

});


// ================= GET ONE STARTUP =================
router.get("/:id", (req, res) => {

    readData((err, data) => {

        if (err) return res.status(500).json({ message: "Database read error" });

        const startup = data.startups.startup.find(
            s => s.id?.[0] === req.params.id
        );

        if (!startup) return res.status(404).json({ message: "Startup not found" });

        res.json(startup);
    });
});


// ================= POST MESSAGE =================
router.post("/:id/message", (req, res) => {

    const { email, text } = req.body;

    if (!email || !text) {
        return res.json({ message: "Missing fields" });
    }

    readData((err, data) => {

        if (err) return res.status(500).json({ message: "Database read error" });

        const startup = data.startups.startup.find(
            s => s.id?.[0] === req.params.id
        );

        if (!startup) return res.status(404).json({ message: "Startup not found" });

        if (!getMembers(startup).includes(email)) {
            return res.status(403).json({ message: "Only startup members can send messages" });
        }

        // Initialise messages array if this is the first post
        if (!startup.messages) {
            startup.messages = [{ message: [] }];
        }
        if (!startup.messages[0].message) {
            startup.messages[0].message = [];
        }

        startup.messages[0].message.push({
            author: [email],
            text:   [text],
            ts:     [Date.now().toString()]
        });

        writeData(data, () => {
            res.json({ message: "Message posted" });
        });
    });
});


module.exports = router;
