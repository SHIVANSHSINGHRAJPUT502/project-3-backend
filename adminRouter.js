// adminRouter.js
import express from 'express';
import adminCoreRouter from './adminCoreRouter.js';
import adminPdfsRouter from './adminPdfsRouter.js';

const router = express.Router();

router.use('/', adminCoreRouter);
router.use('/', adminPdfsRouter);

export default router;