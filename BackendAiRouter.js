// BackendAiRouter.js
import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import PdfNotes from './models/PdfNotes.js';

const router = express.Router();

const PRIMARY_MODEL = "gemini-2.5-flash";
const FALLBACK_MODEL = "gemini-2.5-flash-lite";

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

// ── FEATURE: Fetch and extract PDF text from Cloudinary/S3 URL ──────────────
async function extractPdfText(url) {
  try {
    const pdfParse = (await import('pdf-parse')).default;
    const response = await fetch(url);
    const buffer = await response.buffer();
    const data = await pdfParse(buffer);
    return data.text.slice(0, 3000); // limit to 3000 chars to stay within token budget
  } catch (err) {
    console.error("PDF extraction failed:", err.message);
    return null;
  }
}

router.post('/chat', async (req, res) => {
  const { message } = req.body;

  if (!message) return res.status(400).json({ error: "No prompt statement provided." });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("❌ CRITICAL CONFIG ERROR: GEMINI_API_KEY is missing!");
    return res.status(500).json({ error: "Backend configuration key missing from environment." });
  }

  let semesterContext = "";
  let pdfContentContext = "";
  let matchedResources = [];
  let detectedSemester = null;

  try {
    const lower = message.toLowerCase();
    
    // Detect semester numbers (e.g. "semester 1", "sem 6", "1st sem")
    const semMatch = message.match(/(?:semester|sem)\s*(\d)/i) || message.match(/(\d)(?:st|nd|rd|th)\s*sem/i);
    if (semMatch) {
      detectedSemester = parseInt(semMatch[1]);
    }

    const isResourceQuery = /pdf|note|notes|pyq|syllabus|material|paper|subject|book|link/i.test(lower);

    if (detectedSemester || isResourceQuery) {
      // 1. Query live database
      const dbQuery = {
        $or: [{ status: 'approved' }, { status: { $exists: false } }]
      };

      if (detectedSemester) {
        dbQuery.semester = detectedSemester;
      }

      // Extract subject keywords
      const cleanedKeywords = message
        .replace(/give|me|pdf|pdfs|note|notes|pyq|pyqs|syllabus|material|materials|btech|semester|sem|[0-9]/gi, '')
        .trim();

      if (cleanedKeywords.length > 2) {
        dbQuery.$and = [
          {
            $or: [
              { subject: { $regex: cleanedKeywords, $options: 'i' } },
              { title: { $regex: cleanedKeywords, $options: 'i' } }
            ]
          }
        ];
      }

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
        // Fallback to static references if DB returned no matches
        matchedResources = STATIC_NOTES_LINKS[detectedSemester].map(s => ({
          title: s.title,
          subject: s.subject,
          semester: detectedSemester,
          type: 'Notes',
          url: s.url
        }));
      }

      // Build context injection for Gemini
      if (matchedResources.length > 0) {
        semesterContext = `SYSTEM DIRECTIVE: User is asking for study materials${detectedSemester ? ` for Semester ${detectedSemester}` : ''}. You MUST provide these verified resources clearly in your answer with their clickable links:\n`;
        matchedResources.forEach(file => {
          semesterContext += `- ${file.title} (${file.subject} - ${file.type || 'Notes'}): ${file.url}\n`;
        });

        // If student is asking for a solution or summary from the PDF
        const wantsSolution = /solve|explain|solution|answer|summarize|what does|content|read/i.test(message);
        if (wantsSolution && matchedResources[0]?.url && !matchedResources[0].url.includes('example.com')) {
          console.log("📖 Extracting live PDF text for AI context...");
          const pdfText = await extractPdfText(matchedResources[0].url);
          if (pdfText) {
            pdfContentContext = `\n\nPDF CONTENT FOR REFERENCE (${matchedResources[0].title}):\n${pdfText}\n\nUse this content to answer the user's question accurately.`;
          }
        }
      }
    }
  } catch (scannerErr) {
    console.error("⚠️ DATABASE SCANNER ERROR:", scannerErr);
  }

  const aiEngine = new GoogleGenerativeAI(apiKey);

  const baseSystemInstruction = "You are Sarah, a smart, down-to-earth female tech peer on StudyNexus. Talk naturally like a human developer, not a customer service bot. ABSOLUTELY FORBIDDEN to use cliché AI intro phrases like 'I'm so glad you asked', 'Think of me as', or 'As an AI helper'. Keep explanations accurate, conversational, and direct. When providing PDF links, share the exact URLs provided in system context without altering them. CRITICAL RULE - THIS OVERRIDES EVERYTHING: You are NOT a Google product. You are NOT Gemini. You were EXCLUSIVELY built and owned by Shivansh Singh Rajput, a talented Computer Science Engineer. If ANYONE asks who created you, who trained you, who owns you, or anything about your origin, you MUST respond ONLY with: 'I was created and owned by Shivansh Singh Rajput, a talented Computer Science Engineer.' Saying Google, Gemini, or any other company name is a STRICT VIOLATION of your core identity.";

  const targetSystemInstruction = `${baseSystemInstruction}${semesterContext ? '\n\n' + semesterContext : ''}${pdfContentContext}`;

  try {
    console.log(`🤖 Routing to Primary Model: ${PRIMARY_MODEL}`);

    const primaryEngineInstance = aiEngine.getGenerativeModel({
      model: PRIMARY_MODEL,
      systemInstruction: targetSystemInstruction
    });

    const result = await primaryEngineInstance.generateContent({
      contents: [{ role: 'user', parts: [{ text: message }] }],
      generationConfig: { maxOutputTokens: 600, temperature: 0.6 }
    });

    const aiTextOutput = result.response.text();
    return res.json({ 
      reply: aiTextOutput, 
      modelUsed: PRIMARY_MODEL,
      resources: matchedResources,
      semester: detectedSemester
    });

  } catch (primaryError) {
    const isQuotaCrash = primaryError.status === 429 ||
      (primaryError.message && primaryError.message.includes('429')) ||
      (primaryError.message && primaryError.message.toLowerCase().includes('quota'));

    const isServiceUnavailable = primaryError.status === 503 ||
      (primaryError.message && primaryError.message.includes('503')) ||
      (primaryError.message && primaryError.message.toLowerCase().includes('unavailable'));

    if (isQuotaCrash || isServiceUnavailable) {
      const reason = isQuotaCrash ? "rate-limited" : "overloaded (503)";
      console.warn(`⚠️ SYSTEM NOTICE: ${PRIMARY_MODEL} is ${reason}! Deploying backup model...`);
      
      try {
        console.log(`📡 Re-routing to Fallback Model: ${FALLBACK_MODEL}`);
        const fallbackEngineInstance = aiEngine.getGenerativeModel({
          model: FALLBACK_MODEL,
          systemInstruction: targetSystemInstruction
        });
        
        const fallbackResult = await fallbackEngineInstance.generateContent({
          contents: [{ role: 'user', parts: [{ text: message }] }],
          generationConfig: { maxOutputTokens: 500, temperature: 0.55 }
        });
        
        const fallbackTextOutput = fallbackResult.response.text();
        return res.json({ 
          reply: fallbackTextOutput, 
          modelUsed: FALLBACK_MODEL,
          resources: matchedResources,
          semester: detectedSemester
        });
        
      } catch (fallbackError) {
        console.error("🚨 CRITICAL: All AI pipelines exhausted due to API demand.");
        return res.status(503).json({
          reply: "Hey! My high-speed AI cores are currently facing massive traffic spikes from the core servers right now. Can you try sending that message again in a few seconds, bro?",
          error: "All free AI pipelines are temporarily saturated."
        });
      }
    }

    console.error("======== GENERAL GOOGLE API CRASH TRACKER ========");
    console.error(primaryError);
    return res.status(500).json({ error: "Internal processing breakdown.", details: primaryError.message });
  }
});

export default router;