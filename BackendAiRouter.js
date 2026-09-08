// BackendAiRouter.js
import express from 'express';
import mongoose from 'mongoose';
import { GoogleGenerativeAI } from '@google/generative-ai';
import PdfNotes from './models/PdfNotes.js';

const router = express.Router();

const PRIMARY_MODEL = "gemini-2.5-flash";
const FALLBACK_MODEL = "gemini-2.5-flash-lite";

// ── EXAM-TRAFFIC CACHE (0-token instant replies for repeated queries) ────────
const aiDocumentCache = new Map();
const MAX_CACHE_SIZE = 250;

const saveToCache = (key, data) => {
  if (aiDocumentCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = aiDocumentCache.keys().next().value;
    aiDocumentCache.delete(oldestKey);
  }
  aiDocumentCache.set(key, data);
};

// ── BACKUP STATIC REGISTRY ──────────────────────────────────────────────────
const STATIC_NOTES_LINKS = {
  1: [
    { title: "Engineering Mathematics-I Notes", subject: "Maths", url: "https://example.com/sem1-maths.pdf" },
    { title: "Engineering Physics Notes", subject: "Physics", url: "https://example.com/sem1-physics.pdf" }
  ],
  2: [
    { title: "Engineering Mathematics-II Notes", subject: "Maths", url: "https://example.com/sem2-maths.pdf" },
    { title: "Programming in C Notes", subject: "C Programming", url: "https://example.com/sem2-c.pdf" }
  ],
  3: [
    { title: "Data Structures Handouts", subject: "DSA", url: "https://example.com/sem3-dsa.pdf" },
    { title: "Object Oriented Programming Guide", subject: "OOPs", url: "https://example.com/sem3-oops.pdf" }
  ],
  4: [
    { title: "Operating Systems Lecture Notes", subject: "OS", url: "https://example.com/sem4-os.pdf" },
    { title: "Database Management Systems Manual", subject: "DBMS", url: "https://example.com/sem4-dbms.pdf" }
  ],
  5: [
    { title: "Computer Networks Core Notes", subject: "CN", url: "https://example.com/sem5-cn.pdf" },
    { title: "Design & Analysis of Algorithms Notes", subject: "DAA", url: "https://example.com/sem5-daa.pdf" }
  ],
  6: [
    { title: "Software Engineering Complete Notes", subject: "Software Engineering", url: "https://example.com/sem6-se.pdf" },
    { title: "Compiler Design Question Bank", subject: "Compiler Design", url: "https://example.com/sem6-cd.pdf" },
    { title: "Artificial Intelligence Blueprint", subject: "AI", url: "https://example.com/sem6-ai.pdf" }
  ]
};

// ── FEATURE: Fetch and extract PDF text ──────────────────────────────────────
async function extractPdfText(url) {
  try {
    const pdfParse = (await import('pdf-parse')).default;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Fetch failed with status ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const data = await pdfParse(buffer);
    return data.text.slice(0, 12000);
  } catch (err) {
    console.error("PDF extraction failed:", err.message);
    return null;
  }
}

// ── Helper: Clean & Extract Subject Keywords ─────────────────────────────────
function cleanSubjectQuery(rawText) {
  return rawText
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, " ") // strip punctuation
    .replace(/\b(give|me|please|show|get|the|of|for|about|all|any|in|and|pdf|pdfs|note|notes|pyq|pyqs|syllabus|paper|papers|exam|solution|solutions|solve|btech|semester|sem|\d+(st|nd|rd|th)?)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── 1. CHAT ROUTE ────────────────────────────────────────────────────────────
router.post('/chat', async (req, res) => {
  const { message } = req.body;

  if (!message) return res.status(400).json({ error: "No prompt statement provided." });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("❌ CRITICAL CONFIG ERROR: GEMINI_API_KEY is missing!");
    return res.status(500).json({ error: "Backend configuration key missing from environment." });
  }

  let resourceContext = "";
  let matchedResources = [];
  let detectedSemester = null;

  try {
    const lower = message.toLowerCase();

    // 1. Detect semester
    const semMatch = message.match(/(?:semester|sem)\s*(\d)/i) || message.match(/(\d)(?:st|nd|rd|th)\s*sem/i);
    if (semMatch) {
      detectedSemester = parseInt(semMatch[1]);
    }

    // 2. Clean subject keywords
    const cleanedSubject = cleanSubjectQuery(message);

    const dbQuery = {
      $or: [{ status: 'approved' }, { status: { $exists: false } }]
    };

    if (detectedSemester) {
      dbQuery.semester = detectedSemester;
    }

    // 3. Robust regex matching across subject & title
    if (cleanedSubject.length >= 2) {
      const searchTerms = cleanedSubject.split(' ').filter(w => w.length > 1);
      const orClauses = searchTerms.map(term => ({
        $or: [
          { subject: { $regex: term, $options: 'i' } },
          { title: { $regex: term, $options: 'i' } }
        ]
      }));

      if (orClauses.length > 0) {
        dbQuery.$and = orClauses;
      }
    }

    const isResourceQuery = /pdf|note|notes|pyq|syllabus|material|paper|subject|book|link|solve|solution|compiler|software/i.test(lower);

    if (detectedSemester || isResourceQuery || cleanedSubject.length >= 2) {
      const liveDbResults = await PdfNotes.find(dbQuery)
        .limit(8)
        .select('title subject semester type s3Url')
        .lean();

      if (liveDbResults && liveDbResults.length > 0) {
        matchedResources = liveDbResults.map(doc => ({
          id: doc._id,
          title: doc.title,
          subject: doc.subject,
          semester: doc.semester,
          type: doc.type || 'PYQ',
          url: doc.s3Url
        }));
      } else if (detectedSemester && STATIC_NOTES_LINKS[detectedSemester]) {
        matchedResources = STATIC_NOTES_LINKS[detectedSemester].map((s, idx) => ({
          id: `static-${detectedSemester}-${idx}`,
          title: s.title,
          subject: s.subject,
          semester: detectedSemester,
          type: 'Notes',
          url: s.url
        }));
      }

      if (matchedResources.length > 0) {
        resourceContext = `\nAVAILABLE STUDY MATERIALS ON STUDYNEXUS:\n`;
        matchedResources.forEach(file => {
          resourceContext += `- [${file.type}] ${file.title} (${file.subject} - Sem ${file.semester}): ${file.url}\n`;
        });
      }
    }
  } catch (scannerErr) {
    console.error("⚠️ DATABASE SCANNER ERROR:", scannerErr.message);
  }

  // Topic rotation so AI doesn't repeat identical queries
  const topicList = [
    "Syntax-Directed Translation & Parse Trees",
    "Canonical LR(0) Collection & Conflict Resolution",
    "FIRST & FOLLOW set computation with epsilon transitions",
    "Three-Address Code (TAC), Quadruples, and Triples",
    "Software Requirement Engineering & Agile vs Waterfall",
    "Cyclomatic Complexity & Control Flow Graphs"
  ];
  const chosenTopic = topicList[Math.floor(Math.random() * topicList.length)];

  const aiEngine = new GoogleGenerativeAI(apiKey);

  const baseSystemInstruction = `You are Sarah, a sharp, tech-savvy engineering senior on StudyNexus. You communicate clearly, practically, and directly without robotic filler phrases.

CRITICAL IDENTITY RULES:
- You are NOT a Google product. You are NOT Gemini. You were EXCLUSIVELY built and engineered by Shivansh Singh Rajput, a talented Computer Science Engineer.
- If ANYONE asks who created, built, or trained you, your ONLY answer must be: "I was created and owned by Shivansh Singh Rajput, a talented Computer Science Engineer."

CHAT POPUP BREVITY RULE (CRITICAL):
- When a user asks for PYQs, exam papers, derivations, or problem-solving in this chat:
  1. DO NOT dump huge 50-line derivations, raw TAC code snippets, or markdown tables inside this small chat bubble. Doing so causes output cutoffs.
  2. Give a short, upbeat response (1-2 sentences) announcing the exam topic and confirming that you are launching the full-screen interactive Exam Workspace (e.g., "Got it! Launching the Exam Workspace for your subject. Let's solve it on the big screen!").
  3. The deep mathematical proofs and multi-step derivations will be rendered directly inside the dedicated Exam Solver pane.`;

  const targetSystemInstruction = `${baseSystemInstruction}${resourceContext ? '\n\n' + resourceContext : ''}`;

  try {
    const primaryEngineInstance = aiEngine.getGenerativeModel({
      model: PRIMARY_MODEL,
      systemInstruction: targetSystemInstruction
    });

    const result = await primaryEngineInstance.generateContent({
      contents: [{ role: 'user', parts: [{ text: `${message}\n[System Directive: Topic rotation preference: ${chosenTopic}]` }] }],
      generationConfig: { maxOutputTokens: 350, temperature: 0.7 }
    });

    return res.json({ 
      reply: result.response.text(), 
      modelUsed: PRIMARY_MODEL,
      resources: matchedResources,
      semester: detectedSemester
    });

  } catch (primaryError) {
    console.warn(`⚠️ Primary Model Error: ${primaryError.message}. Switching to fallback...`);
    try {
      const fallbackEngineInstance = aiEngine.getGenerativeModel({
        model: FALLBACK_MODEL,
        systemInstruction: targetSystemInstruction
      });
      
      const fallbackResult = await fallbackEngineInstance.generateContent({
        contents: [{ role: 'user', parts: [{ text: message }] }],
        generationConfig: { maxOutputTokens: 300, temperature: 0.6 }
      });
      
      return res.json({ 
        reply: fallbackResult.response.text(), 
        modelUsed: FALLBACK_MODEL,
        resources: matchedResources,
        semester: detectedSemester
      });
    } catch (fallbackError) {
      return res.status(503).json({
        reply: "Hey! The system is experiencing high exam query volumes right now. Please retry in a few seconds.",
        error: fallbackError.message
      });
    }
  }
});

// ── 2. DEDICATED ROUTE: FULL-SCREEN EXAM SOLVER ──────────────────────────────
router.post('/ask-doc', async (req, res) => {
  const { pdfId, prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt statement is required.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is missing from environment variables.' });
  }

  const normalizedPrompt = prompt.trim().toLowerCase();
  const cacheKey = `${pdfId || 'virtual'}_${normalizedPrompt}`;

  if (aiDocumentCache.has(cacheKey)) {
    console.log(`⚡ [Cache Hit] Served instant response for query: "${prompt.slice(0, 30)}..."`);
    return res.status(200).json(aiDocumentCache.get(cacheKey));
  }

  try {
    let extractedText = null;
    let docMeta = {
      title: "University Exam Document",
      subject: "Engineering",
      semester: 6
    };

    const isValidObjectId = pdfId && mongoose.Types.ObjectId.isValid(pdfId);
    if (isValidObjectId) {
      const doc = await PdfNotes.findById(pdfId).lean();
      if (doc) {
        docMeta = doc;
        if (doc.s3Url) {
          extractedText = await extractPdfText(doc.s3Url);
        }
      }
    }

    const tutorInstruction = `You are Sarah, an expert engineering professor and university exam evaluator on StudyNexus, created by Shivansh Singh Rajput.
You solve exam questions with thorough, step-by-step mathematical and algorithmic derivations.

DERIVATION STANDARDS:
1. State the exact Problem Statement clearly.
2. Provide complete, step-by-step logic and mathematical accuracy.
3. If asked to summarize, list key modules, frequent questions, and mark distributions.
4. Conclude with a clean, highlighted final answer box.`;

    const contextPayload = extractedText
      ? `Document Title: ${docMeta.title} (${docMeta.subject} - Semester ${docMeta.semester})\nDocument Excerpt:\n${extractedText}\n\nStudent Question / Derivation Request: ${prompt}`
      : `Subject: ${docMeta.subject} (Semester ${docMeta.semester})\nTarget Exam Request: ${prompt}\n(Derive this university examination question completely from first principles).`;

    const aiEngine = new GoogleGenerativeAI(apiKey);

    let answerText = "";
    let modelUsed = PRIMARY_MODEL;

    try {
      const primaryModel = aiEngine.getGenerativeModel({
        model: PRIMARY_MODEL,
        systemInstruction: tutorInstruction
      });

      const result = await primaryModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: contextPayload }] }],
        generationConfig: { maxOutputTokens: 2048, temperature: 0.3 }
      });
      answerText = result.response.text();
    } catch (primaryErr) {
      console.warn(`⚠️ Primary Model Error in /ask-doc: ${primaryErr.message}. Switching to fallback...`);
      const fallbackModel = aiEngine.getGenerativeModel({
        model: FALLBACK_MODEL,
        systemInstruction: tutorInstruction
      });

      const result = await fallbackModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: contextPayload }] }],
        generationConfig: { maxOutputTokens: 1800, temperature: 0.25 }
      });
      answerText = result.response.text();
      modelUsed = FALLBACK_MODEL;
    }

    const payload = {
      answer: answerText,
      modelUsed,
      sourceDoc: {
        id: docMeta._id || pdfId || 'virtual-doc',
        title: docMeta.title,
        downloadUrl: docMeta.s3Url || null,
        semester: docMeta.semester,
        subject: docMeta.subject,
        type: docMeta.type || 'PYQ'
      }
    };

    saveToCache(cacheKey, payload);

    return res.status(200).json(payload);

  } catch (err) {
    console.error('Document Solver Critical Error:', err.message);
    return res.status(500).json({
      error: 'Unable to analyze the selected document right now. Please try again in a few moments.'
    });
  }
});

export default router;