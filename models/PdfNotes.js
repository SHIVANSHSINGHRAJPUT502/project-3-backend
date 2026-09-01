// models/PdfNotes.js
import mongoose from 'mongoose';

const PdfNotesSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  semester: { type: Number, required: true },
  subject: { type: String, required: true, trim: true },
  type: { 
    type: String, 
    enum: ['notes', 'pyq', 'syllabus'], 
    default: 'notes',
    lowercase: true,
    trim: true
  },
  s3Url: { type: String, required: true, trim: true },
  uploaderName: { type: String, default: 'Student Contributor', trim: true },
  status: { type: String, default: 'approved', trim: true }, // 'pending' | 'approved'
  uploadedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// Prevent model overwrite errors during Vercel hot reloads while preserving your exact 'pdf_notes' collection
const PdfNotes = mongoose.models.PdfNotes || mongoose.model('PdfNotes', PdfNotesSchema, 'pdf_notes');

export default PdfNotes;