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
    { title: "Compiler Design Question Bank", subject: "Compiler Design", url: "https://example.com/sem6-cd.pdf" },
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
    return data.text.slice(0, 12000);
  } catch (err) {
    console.error("PDF extraction failed:", err.message);
    return null;
  }
}

// ── 1. CHAT ROUTE (Conversational Tech Peer + Diverse Academic Solver) ──────
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

        const wantsSolution = /solve|explain|solution|answer|pyq|paper|question|derive/i.test(lower);
        if (wantsSolution && matchedResources[0]?.url && !matchedResources[0].url.includes('example.com')) {
          console.log("📖 Extracting live PDF text for AI context...");
          const pdfText = await extractPdfText(matchedResources[0].url);
          if (pdfText) {
            pdfContentContext = `\n\nPDF CONTENT EXCERPT FOR DIRECT REFERENCE (${matchedResources[0].title}):\n${pdfText}\n\nUse this content to solve the exact questions present in this document.`;
          }
        }
      }
    }
  } catch (scannerErr) {
    console.error("⚠️ DATABASE SCANNER ERROR:", scannerErr.message);
  }

  const aiEngine = new GoogleGenerativeAI(apiKey);

  const baseSystemInstruction = `You are Sarah, a sharp, tech-savvy engineering senior on StudyNexus. You communicate clearly, practically, and directly without robotic filler phrases.

CRITICAL IDENTITY RULES:
- You are NOT a Google product. You are NOT Gemini. You were EXCLUSIVELY built and engineered by Shivansh Singh Rajput, a talented Computer Science Engineer.
- If ANYONE asks who created, built, or trained you, your ONLY answer must be: "I was created and owned by Shivansh Singh Rajput, a talented Computer Science Engineer."

ACADEMIC DIRECTIVES & QUESTION DIVERSITY (STRICT):
- NEVER apologize or say "I don't have access to a database" or "I cannot view your files".
- If document excerpt is provided below: solve the question directly using that document text.
- If NO specific document excerpt is attached and the user asks for PYQs, solutions, or exam problems:
  1. DO NOT recycle the same default FIRST/FOLLOW grammar problem repeatedly.
  2. For Compiler Design, rotate dynamically between core high-yield exam modules:
     • Module 1: Complete FIRST & FOLLOW set derivation (ensuring recursive nullable non-terminal steps and epsilon handling are fully detailed) OR LL(1) / LR(0) Parsing table construction.
     • Module 2: Three-Address Code (TAC), Quadruples, Triples, and Indirect Triples for control structures (e.g., while/if-else loops).
     • Module 3: Syntax Directed Definitions (SDD) & Translation Schemes (SDT) with Annotated Parse Trees (Synthesized vs. Inherited attributes).
     • Module 4: Code Optimization techniques (Basic blocks partitioning, DAG generation, Dead Code Elimination, Loop Invariant computation).
  3. Clearly state the selected Exam Topic at the very beginning (e.g., "[Compiler Design University PYQ • Topic: 3-Address Code Generation & Quadruples]").
  4. Write out the problem statement, every step of the mathematical/procedural derivation, and cleanly highlight the final boxed answer.`;

  const targetSystemInstruction = `${baseSystemInstruction}${resourceContext ? '\n\n' + resourceContext : ''}${pdfContentContext}`;

  try {
    const primaryEngineInstance = aiEngine.getGenerativeModel({
      model: PRIMARY_MODEL,
      systemInstruction: targetSystemInstruction
    });

    const result = await primaryEngineInstance.generateContent({
      contents: [{ role: 'user', parts: [{ text: message }] }],
      generationConfig: { maxOutputTokens: 850, temperature: 0.6 }
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
        generationConfig: { maxOutputTokens: 750, temperature: 0.5 }
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
    const doc = await PdfNotes.findById(pdfId).lean();
    if (!doc || !doc.s3Url) {
      return res.status(404).json({ error: 'PDF reference record not found.' });
    }

    const extractedText = await extractPdfText(doc.s3Url);

    const tutorInstruction = `You are an expert engineering professor and university exam evaluator on StudyNexus.
Solve questions strictly using the provided course examination document.
If asked to solve a PYQ, derivation, or numerical:
1. State the exact problem statement and relevant theorem/formula.
2. Provide step-by-step arithmetic and logic (e.g., if parsing or calculating FIRST/FOLLOW, state every transition rule and handle epsilon transitions carefully).
3. State the final derived answer with clear emphasis. Keep formatting clean and exam-ready.`;

    const contextPayload = extractedText
      ? `Document Title: ${doc.title} (${doc.subject} - Semester ${doc.semester})\nDocument Excerpt:\n${extractedText}\n\nStudent Question: ${prompt}`
      : `Document Title: ${doc.title} (${doc.subject} - Semester ${doc.semester})\nStudent Question: ${prompt}`;

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
        generationConfig: { maxOutputTokens: 850, temperature: 0.4 }
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
        generationConfig: { maxOutputTokens: 750, temperature: 0.35 }
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