// adminPdfsRouter.js
import express from 'express';
import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';
import mongoose from 'mongoose';
import PdfNotes from './models/PdfNotes.js';
import { verifyAdmin } from './adminCoreRouter.js';

const router = express.Router();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files allowed'));
  }
});

// ── Serverless Reconnect Guard ───────────────────────────────────────────────
const ensureDbConnection = async () => {
  if (mongoose.connection.readyState === 1) return;
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is missing from environment variables');
  }
  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 8000,
    socketTimeoutMS: 45000,
  });
};

// ── Public Submissions & Moderation Queue ─────────────────────────────────────
router.post('/notes/submit-file', upload.single('pdf'), async (req, res) => {
  try {
    const { 
      title, 
      subject, 
      semester, 
      type, 
      fileUrl, 
      uploaderName, 
      name, 
      uploadedBy, 
      uploader, 
      author 
    } = req.body;

    if (!title || !subject || !semester) {
      return res.status(400).json({ error: 'Title, subject, and semester are required' });
    }

    let finalPdfUrl = fileUrl;

    if (req.file) {
      const uploadResult = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            resource_type: 'raw',
            folder: 'studynexus/community_uploads',
            public_id: `sem${semester}_${Date.now()}`,
            access_mode: 'public',
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        stream.end(req.file.buffer);
      });
      finalPdfUrl = uploadResult.secure_url;
    }

    if (!finalPdfUrl) {
      return res.status(400).json({ error: 'Please select a PDF file or provide a valid link' });
    }

    // Ensure database connection is active right after Cloudinary finishes
    await ensureDbConnection();

    // Normalize type to lowercase so enum validation passes
    const cleanType = (type || 'notes').toLowerCase().trim();

    // Extract uploader name with support for common frontend aliases
    const finalUploaderName = (uploaderName || name || uploadedBy || uploader || author || 'Student Contributor').trim();

    const note = await PdfNotes.create({
      title: title.trim(),
      subject: subject.trim(),
      semester: Number(semester),
      type: cleanType,
      s3Url: finalPdfUrl.trim(),
      uploaderName: finalUploaderName,
      status: 'pending'
    });

    return res.status(201).json({
      message: 'Resource submitted successfully! Waiting for admin review.',
      note
    });
  } catch (err) {
    console.error('File submission error:', err);
    return res.status(500).json({ error: 'Upload failed', details: err.message });
  }
});

router.post('/notes/submit', async (req, res) => {
  try {
    const { 
      title, 
      subject, 
      semester, 
      type, 
      s3Url, 
      fileUrl, 
      uploaderName, 
      name, 
      uploadedBy, 
      uploader, 
      author 
    } = req.body;
    const pdfUrl = s3Url || fileUrl;

    if (!title || !subject || !semester || !pdfUrl) {
      return res.status(400).json({ error: 'Title, subject, semester, and PDF link are required' });
    }

    await ensureDbConnection();
    const cleanType = (type || 'notes').toLowerCase().trim();

    // Extract uploader name with support for common frontend aliases
    const finalUploaderName = (uploaderName || name || uploadedBy || uploader || author || 'Student Contributor').trim();

    const note = await PdfNotes.create({
      title: title.trim(),
      subject: subject.trim(),
      semester: Number(semester),
      type: cleanType,
      s3Url: pdfUrl.trim(),
      uploaderName: finalUploaderName,
      status: 'pending'
    });

    return res.status(201).json({ 
      message: 'Request submitted! Waiting for admin approval.', 
      note 
    });
  } catch (err) {
    return res.status(500).json({ error: 'Submission failed', details: err.message });
  }
});

router.get('/notes/pending', verifyAdmin, async (req, res) => {
  try {
    await ensureDbConnection();
    const pending = await PdfNotes.find({ status: 'pending' }).sort({ createdAt: -1 }).lean();
    return res.json({ notes: pending || [] });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch pending submissions' });
  }
});

router.patch('/notes/:id/approve', verifyAdmin, async (req, res) => {
  try {
    await ensureDbConnection();
    const approved = await PdfNotes.findByIdAndUpdate(
      req.params.id,
      { status: 'approved' },
      { new: true }
    );
    return res.json({ message: 'Submission approved and published live!', note: approved });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to approve note' });
  }
});

router.delete('/notes/:id/reject', verifyAdmin, async (req, res) => {
  try {
    await ensureDbConnection();
    await PdfNotes.findByIdAndDelete(req.params.id);
    return res.json({ message: 'Submission rejected and removed' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to reject note' });
  }
});

// ── Admin Direct PDF Management ───────────────────────────────────────────────
router.get('/pdfs', verifyAdmin, async (req, res) => {
  try {
    await ensureDbConnection();
    const pdfs = await PdfNotes.find({}).sort({ createdAt: -1 }).lean();
    return res.json(pdfs || []);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/pdfs', verifyAdmin, async (req, res) => {
  try {
    const { title, semester, subject, type, s3Url, fileUrl } = req.body;
    await ensureDbConnection();
    const cleanType = (type || 'notes').toLowerCase().trim();

    const pdf = await PdfNotes.create({
      title: title.trim(),
      semester: Number(semester),
      subject: subject.trim(),
      type: cleanType,
      s3Url: (s3Url || fileUrl).trim(),
      status: 'approved'
    });
    return res.status(201).json(pdf);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/pdfs/upload', verifyAdmin, upload.single('pdf'), async (req, res) => {
  try {
    const { title, semester, subject, type } = req.body;

    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!title || !semester || !subject) {
      return res.status(400).json({ error: 'Title, semester and subject required' });
    }

    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'raw',
          folder: 'studynexus/pdfs',
          public_id: `sem${semester}_${Date.now()}`,
          access_mode: 'public',
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      stream.end(req.file.buffer);
    });

    await ensureDbConnection();
    const cleanType = (type || 'notes').toLowerCase().trim();

    const pdf = await PdfNotes.create({
      title: title.trim(),
      semester: Number(semester),
      subject: subject.trim(),
      type: cleanType,
      s3Url: uploadResult.secure_url,
      status: 'approved'
    });

    return res.status(201).json(pdf);
  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/pdfs/:id', verifyAdmin, async (req, res) => {
  try {
    await ensureDbConnection();
    await PdfNotes.findByIdAndDelete(req.params.id);
    return res.json({ message: 'PDF deleted' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;