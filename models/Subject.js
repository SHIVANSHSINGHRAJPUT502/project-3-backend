// models/Subject.js
import mongoose from 'mongoose';

// This acts as a blueprint telling MongoDB exactly what fields a subject card needs
const subjectSchema = new mongoose.Schema({
  semId: { type: String, required: true },     // e.g., "1" or "5"
  name: { type: String, required: true },      // e.g., "Computer Networks"
  code: { type: String, default: "" },         // e.g., "CSE-301"
  credits: { type: String, default: "4" },     // e.g., "4"
  colorKey: { type: String, default: "blue" }  // Controls the UI glass glow color
}, { timestamps: true });

// Check existing model cache first to prevent OverwriteModelError during Vercel hot reloads
const Subject = mongoose.models.Subject || mongoose.model('Subject', subjectSchema);

// Export both default and named export for seamless compatibility across all router imports
export { Subject };
export default Subject;