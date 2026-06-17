-- Cross-Session User Memory
-- Stores user memories/facts that persist across chat sessions
-- Auto-extracted from conversations by AI

CREATE TABLE IF NOT EXISTS user_memories (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Memory categorization
  category TEXT NOT NULL DEFAULT 'general',
  -- Categories: 'preference', 'fact', 'interest', 'communication_style', 'goal', 'context'
  
  -- The actual memory content
  content TEXT NOT NULL,
  
  -- Source tracking
  source_topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  source_message_id TEXT,
  
  -- Importance for priority in context window (1-10)
  importance INTEGER NOT NULL DEFAULT 5 CHECK (importance >= 1 AND importance <= 10),
  
  -- Frequency of relevance (auto-updated when memory is used)
  usage_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  
  -- Timestamps
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_user_memories_user_id ON user_memories(user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_user_memories_category ON user_memories(category);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_user_memories_importance ON user_memories(importance DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_user_memories_user_category ON user_memories(user_id, category);
