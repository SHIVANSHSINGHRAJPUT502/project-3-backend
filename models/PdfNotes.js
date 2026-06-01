import mongoose from 'mongoose';

const PdfNotesSchema = new mongoose.Schema({
  title: { type: String, required: true },       // e.g., "OSI Model Cheat Sheet"
  semester: { type: Number, required: true },    // e.g., 3, 5, 6
  subject: { type: String, required: true },     // e.g., "Computer Networks"
  s3Url: { type: String, required: true },       // The live AWS S3 link
  uploadedAt: { type: Date, default: Date.now }
});

export default mongoose.model('PdfNotes', PdfNotesSchema);