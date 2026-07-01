const fs      = require("fs");
const path    = require("path");
const xml2js  = require("xml2js");

const xmlFilePath = path.join(__dirname, "../database/profiles.xml");
const usersFilePath = path.join(__dirname, "../database/users.xml");
const startupsFilePath = path.join(__dirname, "../database/startups.xml");
const jobsFilePath = path.join(__dirname, "../database/jobs.xml");

// Ensure file exists with valid root element
if (!fs.existsSync(xmlFilePath)) {
    fs.writeFileSync(xmlFilePath, "<profiles></profiles>");
}

// ── READ XML ──────────────────────────────────────────────────────────────────
function readXML(callback) {
    fs.readFile(xmlFilePath, "utf8", (err, data) => {
        if (err) return callback(err);

        const parser = new xml2js.Parser();
        parser.parseString(data, (err, result) => {
            if (err) return callback(err);

            // xml2js parses <profiles></profiles> as { profiles: '' }
            if (!result || !result.profiles || typeof result.profiles !== "object") {
                result = { profiles: { profile: [] } };
            }
            if (!Array.isArray(result.profiles.profile)) {
                result.profiles.profile = [];
            }

            callback(null, result);
        });
    });
}

// ── WRITE XML ─────────────────────────────────────────────────────────────────
function writeXML(data, callback) {
    const builder = new xml2js.Builder();
    const xml     = builder.buildObject(data);
    fs.writeFile(xmlFilePath, xml, callback);
}

function readXmlFile(filePath, emptyRoot, callback) {
    fs.readFile(filePath, "utf8", (err, data) => {
        if (err) return callback(err);

        const parser = new xml2js.Parser({ explicitArray: true });
        parser.parseString(data, (parseErr, result) => {
            if (parseErr || !result || typeof result !== "object") {
                return callback(null, emptyRoot);
            }
            callback(null, result);
        });
    });
}

function writeXmlFile(filePath, data, callback) {
    const builder = new xml2js.Builder();
    fs.writeFile(filePath, builder.buildObject(data), callback);
}

function removeProfileRecord(result, email) {
    result.profiles.profile = result.profiles.profile.filter(
        p => !(p.email && p.email[0] === email)
    );
}

// ── CREATE PROFILE ────────────────────────────────────────────────────────────
exports.createProfile = (req, res) => {
    const {
        name, email, program, joinYear, bio,
        phone, github, linkedin, portfolio,
        resume, profilePicture
    } = req.body;

    if (!name || !email || !program || !joinYear) {
        return res.json({ message: "Missing required fields" });
    }

    readXML((err, result) => {
        if (err) return res.json({ message: "Error reading file" });

        const profiles = result.profiles.profile;
        const existing = profiles.find(p => p.email && p.email[0] === email);
        if (existing) return res.json({ message: "Profile already exists" });

        profiles.push({
            name:           [name],
            email:          [email],
            program:        [program],
            joinYear:       [joinYear],
            bio:            [bio            || ""],
            phone:          [phone          || ""],
            github:         [github         || ""],
            linkedin:       [linkedin       || ""],
            portfolio:      [portfolio      || ""],
            resume:         [resume         || ""],
            profilePicture: [profilePicture || "default.png"],
            skills:         [{ skill: [] }]
        });

        writeXML(result, (err) => {
            if (err) return res.json({ message: "Error saving profile" });
            res.json({ message: "Profile created successfully" });
        });
    });
};

// ── GET PROFILE ───────────────────────────────────────────────────────────────
exports.getProfile = (req, res) => {
    const { email } = req.params;

    readXML((err, result) => {
        if (err) return res.json({ message: "Error reading file" });

        const profile = result.profiles.profile.find(
            p => p.email && p.email[0] === email
        );
        if (!profile) return res.json({ message: "Profile not found" });
        res.json(profile);
    });
};

// ── UPDATE PROFILE ────────────────────────────────────────────────────────────
exports.updateProfile = (req, res) => {
    const { email } = req.params;
    const { bio, phone, github, linkedin, portfolio, resume, profilePicture } = req.body;

    readXML((err, result) => {
        if (err) return res.json({ message: "Error reading file" });

        const profile = result.profiles.profile.find(
            p => p.email && p.email[0] === email
        );
        if (!profile) return res.json({ message: "Profile not found" });

        if (bio            !== undefined) profile.bio            = [bio];
        if (phone          !== undefined) profile.phone          = [phone];
        if (github         !== undefined) profile.github         = [github];
        if (linkedin       !== undefined) profile.linkedin       = [linkedin];
        if (portfolio      !== undefined) profile.portfolio      = [portfolio];
        if (resume         !== undefined) profile.resume         = [resume];
        if (profilePicture !== undefined) profile.profilePicture = [profilePicture];

        writeXML(result, (err) => {
            if (err) return res.json({ message: "Error updating profile" });
            res.json({ message: "Profile updated successfully" });
        });
    });
};

// ── ADD SKILL ─────────────────────────────────────────────────────────────────
exports.addSkill = (req, res) => {
    const { email, skill } = req.body;
    if (!email || !skill) return res.json({ message: "Email and skill required" });

    readXML((err, result) => {
        if (err) return res.json({ message: "Error reading file" });

        const profile = result.profiles.profile.find(
            p => p.email && p.email[0] === email
        );
        if (!profile) return res.json({ message: "Profile not found" });

        if (!profile.skills || !profile.skills[0]) profile.skills = [{ skill: [] }];
        if (!profile.skills[0].skill)              profile.skills[0].skill = [];

        if (profile.skills[0].skill.some(s => s.trim().toLowerCase() === skill.trim().toLowerCase())) {
            return res.json({ message: "Skill already exists" });
        }

        profile.skills[0].skill.push(skill);

        writeXML(result, (err) => {
            if (err) return res.json({ message: "Error adding skill" });
            res.json({ message: "Skill added successfully" });
        });
    });
};

// ── DELETE SKILL ──────────────────────────────────────────────────────────────
exports.deleteSkill = (req, res) => {
    const { email, skill } = req.body;

    readXML((err, result) => {
        if (err) return res.json({ message: "Error reading file" });

        const profile = result.profiles.profile.find(
            p => p.email && p.email[0] === email
        );
        if (!profile) return res.json({ message: "Profile not found" });

        if (!profile.skills || !profile.skills[0]?.skill) {
            return res.json({ message: "No skills found" });
        }

        profile.skills[0].skill = profile.skills[0].skill.filter(s => s !== skill);

        writeXML(result, (err) => {
            if (err) return res.json({ message: "Error removing skill" });
            res.json({ message: "Skill removed successfully" });
        });
    });
};

// ── DELETE PROFILE ────────────────────────────────────────────────────────────
exports.deleteProfile = (req, res) => {
    const { email } = req.params;

    readXML((err, result) => {
        if (err) return res.json({ message: "Error reading file" });

        removeProfileRecord(result, email);

        writeXML(result, (err) => {
            if (err) return res.json({ message: "Error deleting profile" });
            res.json({ message: "Profile deleted successfully" });
        });
    });
};

exports.deleteAccount = (req, res) => {
    const { email } = req.params;

    readXmlFile(usersFilePath, { users: { user: [] } }, (usersErr, usersData) => {
        if (usersErr) return res.status(500).json({ message: "Error reading users" });

        const users = usersData?.users?.user || [];
        const userExists = users.some(u => u.email?.[0] === email);
        if (!userExists) {
            return res.status(404).json({ message: "User not found" });
        }

        usersData.users.user = users.filter(u => u.email?.[0] !== email);

        readXML((profilesErr, profilesData) => {
            if (profilesErr) return res.status(500).json({ message: "Error reading profiles" });
            removeProfileRecord(profilesData, email);

            readXmlFile(startupsFilePath, { startups: { startup: [] } }, (startupsErr, startupsData) => {
                if (startupsErr) return res.status(500).json({ message: "Error reading startups" });

                const startups = startupsData?.startups?.startup || [];
                startupsData.startups.startup = startups
                    .filter(startup => startup.creator?.[0] !== email)
                    .map(startup => {
                        const members = startup.team?.[0]?.member || [];
                        if (!startup.team) startup.team = [{ member: [] }];
                        if (!startup.team[0].member) startup.team[0].member = [];
                        startup.team[0].member = members.filter(member => member !== email);

                        const messages = startup.messages?.[0]?.message || [];
                        if (startup.messages?.[0]?.message) {
                            startup.messages[0].message = messages.filter(
                                message => message.author?.[0] !== email
                            );
                        }

                        return startup;
                    });

                readXmlFile(jobsFilePath, { jobs: { jobList: [{ job: [] }] } }, (jobsErr, jobsData) => {
                    if (jobsErr) return res.status(500).json({ message: "Error reading jobs" });

                    const jobs = jobsData?.jobs?.jobList?.[0]?.job || [];
                    jobsData.jobs.jobList[0].job = jobs
                        .filter(job => job.postedBy?.[0] !== email)
                        .map(job => {
                            if (!job.applicants) job.applicants = [{ applicant: [] }];
                            if (!job.applicants[0].applicant) job.applicants[0].applicant = [];
                            job.applicants[0].applicant = job.applicants[0].applicant.filter(
                                applicant => applicant !== email
                            );
                            return job;
                        });

                    writeXmlFile(usersFilePath, usersData, (writeUsersErr) => {
                        if (writeUsersErr) return res.status(500).json({ message: "Error deleting account" });

                        writeXML(profilesData, (writeProfilesErr) => {
                            if (writeProfilesErr) return res.status(500).json({ message: "Error deleting account" });

                            writeXmlFile(startupsFilePath, startupsData, (writeStartupsErr) => {
                                if (writeStartupsErr) return res.status(500).json({ message: "Error deleting account" });

                                writeXmlFile(jobsFilePath, jobsData, (writeJobsErr) => {
                                    if (writeJobsErr) return res.status(500).json({ message: "Error deleting account" });
                                    res.json({ message: "Account deleted successfully" });
                                });
                            });
                        });
                    });
                });
            });
        });
    });
};

// ── GET ALL PROFILES ──────────────────────────────────────────────────────────
// Returns only student profiles — recruiters are excluded by cross-referencing
// the role field in users.xml. This prevents recruiter accounts that happen to
// have a profile entry from appearing in the Student Profiles view.
exports.getAllProfiles = (req, res) => {
    const usersFile = path.join(__dirname, "../database/users.xml");
    fs.readFile(usersFile, "utf8", (err, udata) => {
        if (err) return res.json({ message: "Error reading users" });
        const uParser = new xml2js.Parser({ explicitArray: true });
        uParser.parseString(udata, (err, uresult) => {
            if (err) return res.json({ message: "Error parsing users" });
            const users = uresult?.users?.user || [];
            const studentEmails = new Set(
                users
                    .filter(u => u.role?.[0] === "student")
                    .map(u => u.email?.[0])
            );
            readXML((err, result) => {
                if (err) return res.json({ message: "Error reading file" });
                const students = result.profiles.profile.filter(
                    p => studentEmails.has(p.email?.[0])
                );
                res.json(students);
            });
        });
    });
};

// ── SEARCH BY SKILL ───────────────────────────────────────────────────────────
exports.searchBySkill = (req, res) => {
    const { skill } = req.params;

    readXML((err, result) => {
        if (err) return res.json({ message: "Error reading file" });

        const filtered = result.profiles.profile.filter(p =>
            p.skills?.[0]?.skill?.some(s => s.trim().toLowerCase() === skill.trim().toLowerCase())
        );
        res.json(filtered);
    });
};
