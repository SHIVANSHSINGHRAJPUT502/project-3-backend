  import mongoose from 'mongoose';

  const PdfNotesSchema = new mongoose.Schema({
    title: { type: String, required: true },
    semester: { type: Number, required: true },
    subject: { type: String, required: true },
    type: { type: String, enum: ['notes', 'pyq', 'syllabus'], default: 'notes' },
    s3Url: { type: String, required: true },
    uploadedAt: { type: Date, default: Date.now }
  });

  export default mongoose.model('PdfNotes', PdfNotesSchema, 'pdf_notes');