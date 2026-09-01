// Subject.js
import mongoose from 'mongoose';

// This acts as a blueprint telling MongoDB exactly what fields a subject card needs
const subjectSchema = new mongoose.Schema({
  semId: { type: String, required: true },    // e.g., "1" or "5"
  name: { type: String, required: true },     // e.g., "Computer Networks"
  code: { type: String, required: true },     // e.g., "CSE-301"
  credits: { type: String, required: true },  // e.g., "4"
  colorKey: { type: String, default: "blue" } // Controls the UI glass glow color
});

export const Subject = mongoose.model('Subject', subjectSchema);