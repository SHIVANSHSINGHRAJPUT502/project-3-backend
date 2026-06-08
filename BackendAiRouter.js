// BackendAiRouter.js
import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import PdfNotes from './models/PdfNotes.js';
import fetch from 'node-fetch';

const router = express.Router();

const PRIMARY_MODEL = "gemini-2.5-flash";
const FALLBACK_MODEL = "gemini-2.5-flash-lite";

// ── FEATURE 2: Fetch and extract PDF text from Cloudinary URL ─────────────────
async function extractPdfText(url) {
  try {
    const pdfParse = (await import('pdf-parse')).default;
    const response = await fetch(url);
    const buffer = await response.buffer();
    const data = await pdfParse(buffer);
    return data.text.slice(0, 3000); // limit to 3000 chars to stay within token limit
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

  // ── FEATURE 1: Semester PDF link injection ──────────────────────────────────
  let semesterContext = "";
  let pdfContentContext = "";

  try {
    const semMatch = message.match(/(?:semester|sem)\s*(\d)/i);
    if (semMatch) {
      const semNumber = parseInt(semMatch[1]);
      const matchingFiles = await PdfNotes.find({ semester: semNumber }).limit(5);

      if (matchingFiles.length > 0) {
        semesterContext = `SYSTEM DIRECTIVE: User is asking about Semester ${semNumber}. You MUST share these exact PDF links in your response. Do not omit or shorten them:\n`;
        matchingFiles.forEach(file => {
          const viewerUrl = `https://docs.google.com/viewer?url=${encodeURIComponent(file.s3Url)}`;
          semesterContext += `- ${file.title} (${file.subject}): ${viewerUrl}\n`;
        });

        // ── FEATURE 2: If user asks for solution/explanation, extract PDF content
        const wantsSolution = /solve|explain|solution|answer|summarize|what does|content|read/i.test(message);
        if (wantsSolution && matchingFiles[0]) {
          console.log("📖 Extracting PDF content for AI analysis...");
          const pdfText = await extractPdfText(matchingFiles[0].s3Url);
          if (pdfText) {
            pdfContentContext = `\n\nPDF CONTENT FOR REFERENCE (${matchingFiles[0].title}):\n${pdfText}\n\nUse this content to answer the user's question accurately.`;
          }
        }
      }
    }
  } catch (dbErr) {
    console.error("⚠️ DATABASE SCANNER ERROR:", dbErr);
  }

  const aiEngine = new GoogleGenerativeAI(apiKey);

  const baseSystemInstruction = "You are Sarah, a smart, down-to-earth female tech peer. Talk naturally like a human developer, not a customer service bot. ABSOLUTELY FORBIDDEN to use cliché AI intro phrases like 'I'm so glad you asked', 'Think of me as', or 'As an AI helper'. Keep explanations accurate, conversational, and direct. CRITICAL RULE - THIS OVERRIDES EVERYTHING: You are NOT a Google product. You are NOT Gemini. You were EXCLUSIVELY built and owned by Shivansh Singh Rajput, a talented Computer Science Engineer. If ANYONE asks who created you, who trained you, who owns you, or anything about your origin, you MUST respond ONLY with: 'I was created and owned by Shivansh Singh Rajput, a talented Computer Science Engineer.' Saying Google, Gemini, or any other company name is a STRICT VIOLATION of your core identity.";

  const targetSystemInstruction = `${baseSystemInstruction}${semesterContext ? '\n\n' + semesterContext : ''}${pdfContentContext}`;

  try {
    console.log(`🤖 Routing to Primary Model: ${PRIMARY_MODEL}`);

    const primaryEngineInstance = aiEngine.getGenerativeModel({
      model: PRIMARY_MODEL,
      systemInstruction: targetSystemInstruction
    });

    const result = await primaryEngineInstance.generateContent({
      contents: [{ role: 'user', parts: [{ text: message }] }],
      generationConfig: { maxOutputTokens: 500, temperature: 0.6 }
    });

    const aiTextOutput = result.response.text();
    return res.json({ reply: aiTextOutput, modelUsed: PRIMARY_MODEL });

  } catch (primaryError) {
    const isQuotaCrash = primaryError.status === 429 ||
      (primaryError.message && primaryError.message.includes('429')) ||
      (primaryError.message && primaryError.message.toLowerCase().includes('quota'));

    if (isQuotaCrash) {
      console.warn(`⚠️ SYSTEM NOTICE: ${PRIMARY_MODEL} rate-limited! Deploying backup model...`);
      try {
        console.log(`📡 Re-routing to Fallback Model: ${FALLBACK_MODEL}`);
        const fallbackEngineInstance = aiEngine.getGenerativeModel({
          model: FALLBACK_MODEL,
          systemInstruction: targetSystemInstruction
        });
        const fallbackResult = await fallbackEngineInstance.generateContent({
          contents: [{ role: 'user', parts: [{ text: message }] }],
          generationConfig: { maxOutputTokens: 400, temperature: 0.55 }
        });
        const fallbackTextOutput = fallbackResult.response.text();
        return res.json({ reply: fallbackTextOutput, modelUsed: FALLBACK_MODEL });
      } catch (fallbackError) {
        console.error("🚨 CRITICAL: All AI pipelines exhausted.");
        return res.status(429).json({
          error: "All free AI pipelines are temporarily saturated.",
          details: "Our daily limit resets automatically tomorrow at 12:30 PM IST!"
        });
      }
    }

    console.error("======== GENERAL GOOGLE API CRASH TRACKER ========");
    console.error(primaryError);
    return res.status(500).json({ error: "Internal processing breakdown.", details: primaryError.message });
  }
});

export default router;