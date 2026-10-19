ALTER TABLE notifications ADD COLUMN review_required INTEGER NOT NULL DEFAULT 0 CHECK (review_required IN (0,1));
