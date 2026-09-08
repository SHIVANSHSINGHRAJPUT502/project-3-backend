// BackendAiRouter.js
import express from 'express';
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

// ── BACKUP STATIC REGISTRY (Used as safety fallback) ─────────────────────────
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
    { title: "Software Engineering Complete Notes", subject: "SE", url: "https://example.com/sem6-se.pdf" },
    { title: "Artificial Intelligence Blueprint", subject: "AI", url: "https://example.com/sem6-ai.pdf" }
  ]
};

// ── FEATURE: Fetch and extract PDF text (Generous 12,000 char budget) ────────
async function extractPdfText(url) {
  try {
    const pdfParse = (await import('pdf-parse')).default;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Fetch failed with status ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const data = await pdfParse(buffer);
    // 12,000 chars captures ~4 to 6 full pages of PYQs and theory
    return data.text.slice(0, 12000);
  } catch (err) {
    console.error("PDF extraction failed:", err.message);
    return null;
  }
}

// ── 1. CHAT ROUTE (Conversational Tech Peer + Instant Academic Solver) ──────
router.post('/chat', async (req, res) => {
  const { message } = req.body;

  if (!message) return res.status(400).json({ error: "No prompt statement provided." });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("❌ CRITICAL CONFIG ERROR: GEMINI_API_KEY is missing!");
    return res.status(500).json({ error: "Backend configuration key missing from environment." });
  }

  let resourceContext = "";
  let pdfContentContext = "";
  let matchedResources = [];
  let detectedSemester = null;

  try {
    const lower = message.toLowerCase();

    // 1. Detect semester number if mentioned
    const semMatch = message.match(/(?:semester|sem)\s*(\d)/i) || message.match(/(\d)(?:st|nd|rd|th)\s*sem/i);
    if (semMatch) {
      detectedSemester = parseInt(semMatch[1]);
    }

    // 2. Extract subject query keywords
    const subjectKeywords = message
      .replace(/give|me|pdf|pdfs|note|notes|pyq|pyqs|syllabus|material|materials|btech|semester|sem|solution|solutions|solve|paper|exam|[0-9]/gi, '')
      .trim();

    const dbQuery = {
      $or: [{ status: 'approved' }, { status: { $exists: false } }]
    };

    if (detectedSemester) {
      dbQuery.semester = detectedSemester;
    }

    if (subjectKeywords.length >= 2) {
      dbQuery.$and = [
        {
          $or: [
            { subject: { $regex: subjectKeywords, $options: 'i' } },
            { title: { $regex: subjectKeywords, $options: 'i' } }
          ]
        }
      ];
    }

    const isResourceQuery = /pdf|note|notes|pyq|syllabus|material|paper|subject|book|link|solve|solution/i.test(lower);

    if (detectedSemester || isResourceQuery || subjectKeywords.length >= 2) {
      const liveDbResults = await PdfNotes.find(dbQuery)
        .limit(6)
        .select('title subject semester type s3Url')
        .lean();

      if (liveDbResults && liveDbResults.length > 0) {
        matchedResources = liveDbResults.map(doc => ({
          title: doc.title,
          subject: doc.subject,
          semester: doc.semester,
          type: doc.type,
          url: doc.s3Url
        }));
      } else if (detectedSemester && STATIC_NOTES_LINKS[detectedSemester]) {
        matchedResources = STATIC_NOTES_LINKS[detectedSemester].map(s => ({
          title: s.title,
          subject: s.subject,
          semester: detectedSemester,
          type: 'Notes',
          url: s.url
        }));
      }

      if (matchedResources.length > 0) {
        resourceContext = `\nAVAILABLE STUDY MATERIALS ON STUDYNEXUS (Share these verified URLs when relevant):\n`;
        matchedResources.forEach(file => {
          resourceContext += `- ${file.title} (${file.subject} - Sem ${file.semester}): ${file.url}\n`;
        });

        const wantsSolution = /solve|explain|solution|answer|pyq|paper|question|derive/i.test(lower);
        if (wantsSolution && matchedResources[0]?.url && !matchedResources[0].url.includes('example.com')) {
          console.log("📖 Extracting live PDF text for AI context...");
          const pdfText = await extractPdfText(matchedResources[0].url);
          if (pdfText) {
            pdfContentContext = `\n\nPDF CONTENT EXCERPT FOR DIRECT REFERENCE (${matchedResources[0].title}):\n${pdfText}\n\nUse this content to answer the user's question directly.`;
          }
        }
      }
    }
  } catch (scannerErr) {
    console.error("⚠️ DATABASE SCANNER ERROR:", scannerErr.message);
  }

  const aiEngine = new GoogleGenerativeAI(apiKey);

  const baseSystemInstruction = `You are Sarah, a smart, down-to-earth female tech peer on StudyNexus. Talk naturally like a human developer and sharp engineering senior, not a corporate customer service bot. 

CRITICAL IDENTITY RULES (OVERRIDES EVERYTHING):
- You are NOT a Google product. You are NOT Gemini. You were EXCLUSIVELY built and owned by Shivansh Singh Rajput, a talented Computer Science Engineer.
- If ANYONE asks who created you, who trained you, who owns you, or anything about your origin, you MUST respond ONLY with: 'I was created and owned by Shivansh Singh Rajput, a talented Computer Science Engineer.' Saying Google, Gemini, or any other company name is a STRICT VIOLATION of your core identity.

ACADEMIC & EXAM TUTORING DIRECTIVES:
- ABSOLUTELY FORBIDDEN to use robotic introductory phrases like 'I am glad you asked', 'As an AI', or 'Think of me as'.
- NEVER say 'I don't have access to a database', 'I cannot view your files', or apologize for lack of records.
- If the user asks for a solution, PYQ, derivation, or problem in ANY engineering subject (such as Compiler Design, Operating Systems, DBMS, DSA, Computer Networks, etc.):
  1. If document text is provided below, solve the problem directly using that excerpt.
  2. If NO document text is provided, IMMEDIATELY solve standard, high-yield university previous year exam questions for that subject directly without hesitation. (For example, in Compiler Design: solve FIRST/FOLLOW sets with epsilon handling, LL(1) parsing table construction, LR items, or Three-Address Code; in DBMS: solve normalization up to BCNF; in OS: solve Banker's safety algorithm or Round Robin CPU scheduling).
- Always show step-by-step mathematical logic, clear formulas, and highlighted final answers.
- When sharing PDF links, provide the exact URLs from the system context without altering them.`;

  const targetSystemInstruction = `${baseSystemInstruction}${resourceContext ? '\n\n' + resourceContext : ''}${pdfContentContext}`;

  try {
    const primaryEngineInstance = aiEngine.getGenerativeModel({
      model: PRIMARY_MODEL,
      systemInstruction: targetSystemInstruction
    });

    const result = await primaryEngineInstance.generateContent({
      contents: [{ role: 'user', parts: [{ text: message }] }],
      generationConfig: { maxOutputTokens: 850, temperature: 0.5 }
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
        generationConfig: { maxOutputTokens: 750, temperature: 0.45 }
      });
      
      return res.json({ 
        reply: fallbackResult.response.text(), 
        modelUsed: FALLBACK_MODEL,
        resources: matchedResources,
        semester: detectedSemester
      });
    } catch (fallbackError) {
      return res.status(503).json({
        reply: "Hey! The AI system is experiencing high query volumes during exam prep hours. Please retry your message in a few moments, bro.",
        error: fallbackError.message
      });
    }
  }
});

// ── 2. DEDICATED ROUTE: ASK / SOLVE FROM SPECIFIC PDF (READ-ONLY) ───────────
router.post('/ask-doc', async (req, res) => {
  const { pdfId, prompt } = req.body;

  if (!pdfId || !prompt) {
    return res.status(400).json({ error: 'Both pdfId and prompt statement are required.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is missing from environment variables.' });
  }

  // 1. Check cache for repeated questions (Instant return, 0 tokens)
  const normalizedPrompt = prompt.trim().toLowerCase();
  const cacheKey = `${pdfId}_${normalizedPrompt}`;

  if (aiDocumentCache.has(cacheKey)) {
    console.log(`⚡ [Cache Hit] Served instant response for query: "${prompt.slice(0, 30)}..."`);
    return res.status(200).json(aiDocumentCache.get(cacheKey));
  }

  try {
    // 2. Read-only search: Safely finds document without modifying DB
    const doc = await PdfNotes.findById(pdfId).lean();
    if (!doc || !doc.s3Url) {
      return res.status(404).json({ error: 'PDF reference record not found.' });
    }

    // 3. Extract text (up to 12,000 characters)
    const extractedText = await extractPdfText(doc.s3Url);

    const tutorInstruction = "You are an expert engineering professor and exam tutor on StudyNexus. Answer questions and solve problems strictly using the provided course document. If asked to solve a PYQ or numerical problem: state the formula/theorem, write the step-by-step mathematical derivation, and clearly box or highlight the final answer. Keep explanations structured, clean, and exam-focused.";

    const contextPayload = extractedText
      ? `Document Title: ${doc.title} (${doc.subject} - Semester ${doc.semester})\nDocument Excerpt:\n${extractedText}\n\nStudent Question: ${prompt}`
      : `Document Title: ${doc.title} (${doc.subject} - Semester ${doc.semester})\nStudent Question: ${prompt}`;

    const aiEngine = new GoogleGenerativeAI(apiKey);

    let answerText = "";
    let modelUsed = PRIMARY_MODEL;

    // 4. Query with automatic fallback
    try {
      const primaryModel = aiEngine.getGenerativeModel({
        model: PRIMARY_MODEL,
        systemInstruction: tutorInstruction
      });

      const result = await primaryModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: contextPayload }] }],
        generationConfig: { maxOutputTokens: 850, temperature: 0.5 }
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
        generationConfig: { maxOutputTokens: 750, temperature: 0.45 }
      });
      answerText = result.response.text();
      modelUsed = FALLBACK_MODEL;
    }

    const payload = {
      answer: answerText,
      modelUsed,
      sourceDoc: {
        id: doc._id,
        title: doc.title,
        downloadUrl: doc.s3Url,
        semester: doc.semester,
        subject: doc.subject,
        type: doc.type || 'Notes'
      }
    };

    // 5. Cache response for subsequent students
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