// BackendAiRouter.js
import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import PdfNotes from './models/PdfNotes.js'; 

const router = express.Router();

const PRIMARY_MODEL = "gemini-2.5-flash";      
const FALLBACK_MODEL = "gemini-2.5-flash-lite"; 

router.post('/chat', async (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: "No prompt statement provided." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("❌ CRITICAL CONFIG ERROR: GEMINI_API_KEY is missing!");
    return res.status(500).json({ error: "Backend configuration key missing from environment." });
  }

  // 🔍 1. DATABASE SCANNER: Look up semester tracking entries
  let semesterContext = "";
  try {
    const semMatch = message.match(/(?:semester|sem)\s*(\d)/i);
    if (semMatch) {
      const semNumber = parseInt(semMatch[1]);
      const matchingFiles = await PdfNotes.find({ semester: semNumber }).limit(3);
      
      if (matchingFiles.length > 0) {
        // Enforce strong, programmatic instructions to make the links mandatory
        semesterContext = `IMPORTANT SYSTEM CONTEXT DIRECTIVE: The user is asking about resources for Semester ${semNumber}. You MUST provide these exact database asset links directly inside your response text so the user can click them. Do not change, shorten, or omit these URLs under any circumstances:\n`;
        matchingFiles.forEach(file => {
          semesterContext += `- ${file.title} (${file.subject}): ${file.s3Url}\n`;
        });
      }
    }
  } catch (dbErr) {
    console.error("⚠️ DATABASE SCANNER ERROR: Could not query PdfNotes collection:", dbErr);
  }

  const aiEngine = new GoogleGenerativeAI(apiKey);
  
  // 💡 SYSTEM PROFILE: Upgraded to blend core personality rules with the runtime database context seamlessly
  const baseSystemInstruction = "You are Sarah, a smart, down-to-earth female tech peer. Talk naturally like a human developer, not a customer service bot. ABSOLUTELY FORBIDDEN to use cliché AI intro phrases like 'I'm so glad you asked', 'Think of me as', or 'As an AI helper'. Keep explanations accurate, conversational, and direct.";
  
  // Combine base personality with our runtime semester links context
  const targetSystemInstruction = semesterContext 
    ? `${baseSystemInstruction}\n\n${semesterContext}`
    : baseSystemInstruction;

  try {
    // 🚀 TIER 1 TRY: Primary Flagship Model Execution
    console.log(`🤖 Routing to Primary Model: ${PRIMARY_MODEL}`);
    
    const primaryEngineInstance = aiEngine.getGenerativeModel({ 
      model: PRIMARY_MODEL,
      systemInstruction: targetSystemInstruction // Injecting dynamic instructions securely here
    });
    
    const result = await primaryEngineInstance.generateContent({
      // Keep the user's message completely clean and separate
      contents: [{ role: 'user', parts: [{ text: message }] }], 
      generationConfig: { maxOutputTokens: 350, temperature: 0.6 }
    });

    const aiTextOutput = result.response.text();
    return res.json({ reply: aiTextOutput, modelUsed: PRIMARY_MODEL });

  } catch (primaryError) {
    const isQuotaCrash = primaryError.status === 429 || 
                         (primaryError.message && primaryError.message.includes('429')) || 
                         (primaryError.message && primaryError.message.toLowerCase().includes('quota'));

    if (isQuotaCrash) {
      console.warn(`⚠️ SYSTEM NOTICE: ${PRIMARY_MODEL} tier crashed or rate-limited! Deploying backup model...`);
      
      try {
        // 🛡️ TIER 2 FALLBACK: Shift execution to high-quota Lite model
        console.log(`📡 Re-routing traffic to Fallback Model: ${FALLBACK_MODEL}`);
        
        const fallbackEngineInstance = aiEngine.getGenerativeModel({ 
          model: FALLBACK_MODEL,
          systemInstruction: targetSystemInstruction
        });
        
        const fallbackResult = await fallbackEngineInstance.generateContent({
          contents: [{ role: 'user', parts: [{ text: message }] }], 
          generationConfig: { maxOutputTokens: 300, temperature: 0.55 }
        });

        const fallbackTextOutput = fallbackResult.response.text();
        return res.json({ reply: fallbackTextOutput, modelUsed: FALLBACK_MODEL });

      } catch (fallbackError) {
        console.error("🚨 CRITICAL: Primary and Fallback buckets completely exhausted for the day.");
        return res.status(429).json({ 
          error: "All free AI pipelines are temporarily saturated.", 
          details: "Our daily limit resets automatically tomorrow at 12:30 PM IST!" 
        });
      }
    }

    console.error("======== GENERAL GOOGLE API CRASH TRACKER ========");
    console.error(primaryError);
    console.log("==================================================");
    return res.status(500).json({ error: "Internal processing breakdown.", details: primaryError.message });
  }
});

export default router;