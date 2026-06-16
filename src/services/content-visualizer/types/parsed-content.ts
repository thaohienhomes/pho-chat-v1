/**
 * Parsed content output from Agent 1: ContentIngestion.
 * Normalized format for any input source (arXiv, PDF, URL, text, topic).
 */

export type ContentSource = 'arxiv' | 'pdf' | 'url' | 'text' | 'topic';

export type DifficultyLevel = 'beginner' | 'intermediate' | 'advanced';

export interface ContentMetadata {
  authors?: string[];
  difficulty: DifficultyLevel;
  language: 'en' | 'vi' | (string & NonNullable<unknown>);
  source: ContentSource;
  sourceUrl?: string;
  title: string;
}

export interface ParsedEquation {
  context: string;
  id: string;
  latex: string;
}

export interface ParsedFigure {
  base64?: string;
  caption: string;
  id: string;
  url?: string;
}

export interface ParsedTable {
  caption: string;
  headers: string[];
  id: string;
  rows: string[][];
}

export interface ContentSection {
  content: string;
  equations: ParsedEquation[];
  figures: ParsedFigure[];
  id: string;
  subsections?: ContentSection[];
  tables: ParsedTable[];
  title: string;
}

export interface ParsedContent {
  abstract?: string;
  metadata: ContentMetadata;
  references?: string[];
  sections: ContentSection[];
}
