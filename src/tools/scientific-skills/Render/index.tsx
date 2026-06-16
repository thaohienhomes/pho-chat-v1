import { memo } from 'react';

import { BuiltinRenderProps } from '@/types/tool';

import { ScientificApiNames } from '../apis';
import ScientificResults from './ScientificResults';

/**
 * Parse paper results from various API response formats
 */
const parsePaperResults = (content: any) => {
  if (!content) return { papers: [], query: undefined, totalResults: 0 };

  // Handle array directly
  if (Array.isArray(content)) {
    return { papers: content, query: undefined, totalResults: content.length };
  }

  // Handle standard response with papers array
  if (content.papers) {
    return {
      papers: content.papers,
      query: content.query,
      totalResults: content.totalResults || content.papers.length,
    };
  }

  // Handle results array (clinical trials, gene results, etc.)
  if (content.results) {
    return {
      papers: content.results.map((r: any) => ({
        authors: r.authors || r.investigators,
        citationCount: r.citationCount,
        doi: r.doi,
        title: r.title || r.name || r.officialTitle,
        url: r.url || r.link,
        venue: r.venue || r.source || r.status,
        year: r.year || r.startDate,
      })),
      query: content.query,
      totalResults: content.totalResults || content.results.length,
    };
  }

  // Handle single item response (UniProt, AlphaFold, Gene)
  if (content.proteinName || content.geneName || content.accession) {
    return {
      papers: [
        {
          title: content.proteinName || content.geneName || content.accession,
          url: content.url,
          venue: content.organism || content.source,
        },
      ],
      query: undefined,
      totalResults: 1,
    };
  }

  // Fallback: try to extract any array
  const arrayKey = Object.keys(content).find((k) => Array.isArray(content[k]));
  if (arrayKey) {
    const items = content[arrayKey];
    return {
      papers: items.map((item: any) => ({
        authors: item.authors,
        citationCount: item.citationCount || item.citations,
        doi: item.doi,
        title: item.title || item.name,
        url: item.url || item.link,
        venue: item.venue || item.journal || item.source,
        year: item.year,
      })),
      query: content.query,
      totalResults: content.totalResults || items.length,
    };
  }

  return { papers: [], query: undefined, totalResults: 0 };
};

const ScientificSkillsRender = memo<BuiltinRenderProps>(({ content, apiName }) => {
  const { papers, query, totalResults } = parsePaperResults(content);

  // Determine if this is a list-type or single-item API
  const isListApi = [
    ScientificApiNames.searchPubMed,
    ScientificApiNames.queryChEMBL,
    ScientificApiNames.searchClinicalTrials,
  ].includes(apiName || '');

  const loading = !content;

  return (
    <ScientificResults
      apiName={apiName}
      loading={loading && isListApi}
      papers={papers}
      query={query}
      totalResults={totalResults}
    />
  );
});

ScientificSkillsRender.displayName = 'ScientificSkillsRender';

export default ScientificSkillsRender;
