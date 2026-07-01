// ════════════════════════════════════════════════════════════════════════════
// AI MATCH ENGINE
// Scores how well a candidate (skills + bio) fits a job (title + required
// skills) on a 0-100 scale, with a short human-readable rationale.
//
// Primary path: calls the Anthropic Messages API (Claude) for true semantic
// understanding — it can tell that "React" satisfies "Frontend frameworks",
// that "Postgres" is a database skill, that "Node.js" implies backend
// experience, etc. Results are cached in-memory so re-rendering a list
// doesn't re-spend API calls.
//
// Fallback path: if no ANTHROPIC_API_KEY is configured (or the call fails),
// we fall back to a local synonym-aware semantic-ish scorer so the feature
// still works out of the box with zero configuration.
// ════════════════════════════════════════════════════════════════════════════

const crypto = require("crypto");

const MODEL = "claude-sonnet-4-6";
const API_URL = "https://api.anthropic.com/v1/messages";
const cache = new Map(); // key -> { score, summary, missing, ts }
const CACHE_TTL_MS = 1000 * 60 * 30; // 30 min

function cacheKey(profileSkills, bio, job) {
    const raw = JSON.stringify({
        s: [...profileSkills].sort(),
        b: (bio || "").slice(0, 300),
        j: job.title,
        r: [...(job.requiredSkills || [])].sort()
    });
    return crypto.createHash("sha1").update(raw).digest("hex");
}

// ── Local fallback scorer ────────────────────────────────────────────────────
// A small synonym/family map lets us catch "obviously related" skills even
// without calling out to an LLM, e.g. React <-> Frontend, Node <-> Backend.
const SKILL_FAMILIES = [
    ["javascript", "js", "typescript", "ts", "node", "node.js", "express", "react", "vue", "angular", "next.js", "frontend", "backend", "html", "css", "tailwind"],
    ["python", "django", "flask", "fastapi", "pandas", "numpy", "pytorch", "tensorflow", "scikit-learn", "machine learning", "ml", "ai", "deep learning", "data science"],
    ["java", "spring", "spring boot", "kotlin", "android"],
    ["sql", "mysql", "postgres", "postgresql", "mongodb", "database", "nosql", "redis"],
    ["aws", "azure", "gcp", "cloud", "docker", "kubernetes", "devops", "ci/cd", "terraform"],
    ["c++", "c", "embedded", "rust", "go", "golang", "systems programming"],
    ["figma", "ui/ux", "design", "product design", "wireframing"],
    ["git", "github", "version control", "agile", "scrum"]
];

function familyOf(skill) {
    const s = skill.trim().toLowerCase();
    for (let i = 0; i < SKILL_FAMILIES.length; i++) {
        if (SKILL_FAMILIES[i].some(f => s.includes(f) || f.includes(s))) return i;
    }
    return -1;
}

function localScore(profileSkills, bio, job) {
    const required = job.requiredSkills || [];
    if (!required.length) {
        return { score: 60, summary: "No specific skills listed for this role — general fit only.", missing: [] };
    }
    const norm = profileSkills.map(s => s.trim().toLowerCase());
    const bioLower = (bio || "").toLowerCase();

    let exact = 0, related = 0;
    const missing = [];
    required.forEach(req => {
        const r = req.trim().toLowerCase();
        if (norm.includes(r)) { exact++; return; }
        const fam = familyOf(r);
        const hasRelated = fam !== -1 && norm.some(s => familyOf(s) === fam);
        const mentionedInBio = bioLower.includes(r);
        if (hasRelated || mentionedInBio) { related++; }
        else { missing.push(req); }
    });

    const total = required.length;
    const raw = (exact * 1 + related * 0.55) / total;
    const score = Math.round(Math.min(100, Math.max(5, raw * 100)));

    let summary;
    if (missing.length === 0) summary = "Strong match — candidate covers (or has closely related experience for) every required skill.";
    else if (score >= 60) summary = `Good match — solid overlap, missing: ${missing.join(", ")}.`;
    else if (score >= 30) summary = `Partial match — some relevant background, but gaps in: ${missing.join(", ")}.`;
    else summary = `Weak match — limited overlap with required skills: ${missing.join(", ")}.`;

    return { score, summary, missing };
}

// ── AI scorer ─────────────────────────────────────────────────────────────
async function aiScore(profileSkills, bio, job) {
    if (!process.env.ANTHROPIC_API_KEY) return null;

    const prompt = `You are a recruiting assistant scoring candidate-job fit.

Job title: ${job.title}
Required skills: ${(job.requiredSkills || []).join(", ") || "(none listed)"}

Candidate skills: ${profileSkills.join(", ") || "(none listed)"}
Candidate bio: ${(bio || "(none provided)").slice(0, 500)}

Consider not just exact keyword matches but genuine semantic/transferable fit
(e.g. React experience is relevant to a "Frontend Developer" role even if
"Frontend Developer" isn't a literal skill tag; Postgres implies SQL/database
skill; etc).

Respond with ONLY raw JSON, no markdown fences, no preamble:
{"score": <integer 0-100>, "summary": "<one sentence, <30 words>", "missing": ["<skill1>", "..."]}`;

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        const res = await fetch(API_URL, {
            method: "POST",
            signal: controller.signal,
            headers: {
                "Content-Type": "application/json",
                "x-api-key": process.env.ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01"
            },
            body: JSON.stringify({
                model: MODEL,
                max_tokens: 300,
                messages: [{ role: "user", content: prompt }]
            })
        });
        clearTimeout(timeout);

        if (!res.ok) return null;
        const data = await res.json();
        const text = (data.content || []).map(b => b.text || "").join("").trim();
        const clean = text.replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(clean);

        if (typeof parsed.score !== "number") return null;
        return {
            score: Math.max(0, Math.min(100, Math.round(parsed.score))),
            summary: parsed.summary || "",
            missing: Array.isArray(parsed.missing) ? parsed.missing : []
        };
    } catch (err) {
        console.warn("AI match engine fallback (reason: " + err.message + ")");
        return null;
    }
}

// ── Public API ────────────────────────────────────────────────────────────
// matchCandidateToJob({skills, bio}, {title, requiredSkills}) -> { score, summary, missing, source }
async function matchCandidateToJob(profile, job) {
    const profileSkills = profile.skills || [];
    const bio = profile.bio || "";
    const key = cacheKey(profileSkills, bio, job);

    const hit = cache.get(key);
    if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit;

    let result = await aiScore(profileSkills, bio, job);
    let source = "ai";
    if (!result) {
        result = localScore(profileSkills, bio, job);
        source = "local";
    }

    const entry = { ...result, source, ts: Date.now() };
    cache.set(key, entry);
    return entry;
}

// Batch helper — scores a profile against many jobs, in parallel (bounded).
async function matchCandidateToJobs(profile, jobs, concurrency = 4) {
    const results = new Array(jobs.length);
    let idx = 0;
    async function worker() {
        while (idx < jobs.length) {
            const i = idx++;
            results[i] = await matchCandidateToJob(profile, jobs[i]);
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
    return results;
}

module.exports = { matchCandidateToJob, matchCandidateToJobs };
