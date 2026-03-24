/**
 * ArXiv parser: fetches and parses ar5iv HTML or falls back to arXiv API + PDF.
 * Extracts structured sections, LaTeX equations, figures, and tables.
 */
import * as cheerio from 'cheerio';

import type {
  ContentSection,
  ParsedContent,
  ParsedEquation,
  ParsedFigure,
  ParsedTable,
} from '../types/parsed-content';

// domhandler is a transitive dep of cheerio but not directly installed
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNode = any;

const ARXIV_ID_REGEX =
  /(?:arxiv\.org\/(?:abs|pdf|html)\/|ar5iv\.labs\.arxiv\.org\/html\/)(\d{4}\.\d{4,5}(?:v\d+)?)/i;
const AR5IV_BASE_URL = 'https://ar5iv.labs.arxiv.org/html';
const ARXIV_API_URL = 'https://export.arxiv.org/api/query';

/**
 * Extract arXiv paper ID from a URL or raw ID string.
 */
export function extractArxivId(input: string): string | undefined {
  const match = ARXIV_ID_REGEX.exec(input);
  if (match) return match[1];

  // Handle raw ID like "2401.12345" or "2401.12345v2"
  const rawIdMatch = /^(\d{4}\.\d{4,5}(?:v\d+)?)$/.exec(input.trim());
  return rawIdMatch?.[1];
}

/**
 * Fetch metadata from arXiv Atom API.
 */
async function fetchArxivMetadata(arxivId: string): Promise<{
  abstract: string;
  authors: string[];
  title: string;
}> {
  const response = await fetch(`${ARXIV_API_URL}?id_list=${arxivId}`);
  if (!response.ok) throw new Error(`arXiv API request failed: ${response.status}`);

  const xml = await response.text();
  const $ = cheerio.load(xml, { xml: true });

  const entry = $('entry').first();
  const title = entry.find('title').text().replaceAll(/\s+/g, ' ').trim();
  const abstract = entry.find('summary').text().replaceAll(/\s+/g, ' ').trim();
  const authors = entry
    .find('author name')
    .map((_i, el) => $(el).text())
    .get();

  return { abstract, authors, title };
}

/**
 * Parse equations from ar5iv HTML math elements.
 */
function parseEquations(
  $: cheerio.CheerioAPI,
  sectionEl: cheerio.Cheerio<AnyNode>,
): ParsedEquation[] {
  const equations: ParsedEquation[] = [];
  let eqIndex = 0;

  sectionEl.find('math[alttext], .ltx_equation').each((_i, el) => {
    const mathEl = $(el);
    const latex =
      mathEl.attr('alttext') || mathEl.find('math').attr('alttext') || mathEl.text().trim();
    if (!latex) return;

    const context = mathEl.parent().text().slice(0, 200).trim();
    eqIndex++;
    equations.push({
      context,
      id: `eq-${eqIndex}`,
      latex,
    });
  });

  return equations;
}

/**
 * Parse figures from ar5iv HTML.
 */
function parseFigures($: cheerio.CheerioAPI, sectionEl: cheerio.Cheerio<AnyNode>): ParsedFigure[] {
  const figures: ParsedFigure[] = [];
  let figIndex = 0;

  sectionEl.find('figure, .ltx_figure').each((_i, el) => {
    const figEl = $(el);
    const img = figEl.find('img').first();
    const caption = figEl.find('figcaption, .ltx_caption').text().trim();
    const url = img.attr('src');

    figIndex++;
    figures.push({
      caption: caption || `Figure ${figIndex}`,
      id: `fig-${figIndex}`,
      url: url || undefined,
    });
  });

  return figures;
}

/**
 * Parse tables from ar5iv HTML.
 */
function parseTables($: cheerio.CheerioAPI, sectionEl: cheerio.Cheerio<AnyNode>): ParsedTable[] {
  const tables: ParsedTable[] = [];
  let tableIndex = 0;

  sectionEl.find('table').each((_i, el) => {
    const tableEl = $(el);
    const caption = tableEl
      .closest('figure, .ltx_table')
      .find('figcaption, .ltx_caption')
      .text()
      .trim();

    const headers: string[] = [];
    tableEl.find('thead th, thead td').each((_j, th) => {
      headers.push($(th).text().trim());
    });

    const rows: string[][] = [];
    tableEl.find('tbody tr').each((_j, tr) => {
      const row: string[] = [];
      $(tr)
        .find('td, th')
        .each((_k, td) => {
          row.push($(td).text().trim());
        });
      if (row.length > 0) rows.push(row);
    });

    tableIndex++;
    tables.push({
      caption: caption || `Table ${tableIndex}`,
      headers,
      id: `tbl-${tableIndex}`,
      rows,
    });
  });

  return tables;
}

/**
 * Parse ar5iv HTML into structured sections.
 */
function parseSections($: cheerio.CheerioAPI): ContentSection[] {
  const sections: ContentSection[] = [];
  let sectionIndex = 0;

  $('section, .ltx_section').each((_i, el) => {
    const sectionEl = $(el);
    const title = sectionEl.find('> h2, > h3, > .ltx_title').first().text().trim();
    if (!title) return;

    // Get text content excluding nested sections
    const cloned = sectionEl.clone();
    cloned.find('section, .ltx_section').remove();
    const content = cloned.text().trim();

    if (!content) return;

    sectionIndex++;
    const sectionId = `sec-${sectionIndex}`;

    // Parse subsections
    const subsections: ContentSection[] = [];
    let subIndex = 0;
    sectionEl.find('> section, > .ltx_subsection').each((_j, subEl) => {
      const subSectionEl = $(subEl);
      const subTitle = subSectionEl.find('> h3, > h4, > .ltx_title').first().text().trim();
      if (!subTitle) return;

      subIndex++;
      subsections.push({
        content: subSectionEl.text().trim(),
        equations: parseEquations($, subSectionEl),
        figures: parseFigures($, subSectionEl),
        id: `${sectionId}-sub-${subIndex}`,
        tables: parseTables($, subSectionEl),
        title: subTitle,
      });
    });

    sections.push({
      content,
      equations: parseEquations($, sectionEl),
      figures: parseFigures($, sectionEl),
      id: sectionId,
      subsections: subsections.length > 0 ? subsections : undefined,
      tables: parseTables($, sectionEl),
      title,
    });
  });

  return sections;
}

/**
 * Parse an arXiv paper URL into structured ParsedContent.
 * Prefers ar5iv HTML, falls back to arXiv API for metadata.
 */
export async function parseArxivUrl(input: string): Promise<ParsedContent> {
  const arxivId = extractArxivId(input);
  if (!arxivId) throw new Error(`Invalid arXiv URL or ID: ${input}`);

  // Fetch ar5iv HTML and API metadata in parallel
  const [htmlResponse, metadata] = await Promise.all([
    fetch(`${AR5IV_BASE_URL}/${arxivId}`),
    fetchArxivMetadata(arxivId),
  ]);

  if (!htmlResponse.ok) {
    throw new Error(
      `ar5iv HTML fetch failed: ${htmlResponse.status}. Paper may not be available on ar5iv.`,
    );
  }

  const html = await htmlResponse.text();
  const $ = cheerio.load(html);
  const sections = parseSections($);

  return {
    abstract: metadata.abstract || undefined,
    metadata: {
      authors: metadata.authors,
      difficulty: 'advanced',
      language: 'en',
      source: 'arxiv',
      sourceUrl: `https://arxiv.org/abs/${arxivId}`,
      title: metadata.title,
    },
    sections,
  };
}
