import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { AppError } from '../lib/errors.js';
import { config } from '../config.js';

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: 'Not found' });
}

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) return res.status(err.status).json({ error: err.message, code: err.code });
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Payload too large' });
  if (err?.code === 'P2002') return res.status(409).json({ error: 'Duplicate value' });
  if (err?.code === 'P2025') return res.status(404).json({ error: 'Not found' });
  if (!config.isTest) console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}
