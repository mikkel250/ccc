/**
 * Candidate knowledge base — read-only markdown on disk.
 *
 * Production tailor-cv uses `getAllContext()` (full injection, no retrieval,
 * fails fast if any file is missing or empty). See docs/arch/README.md.
 */
import fs from 'fs';
import path from 'path';
import { ServiceError } from './errors';

interface KnowledgeBaseConfig {
  basePath: string;
  files: {
    experience: string;
    projects: string;
    skills: string;
    careerStory: string;
    metaProject: string;
  };
}

const KB_CONFIG: KnowledgeBaseConfig = {
  basePath: 'knowledge-base',
  files: {
    experience: 'experience.md',
    projects: 'projects.md',
    skills: 'skills.md',
    careerStory: 'career-story.md',
    metaProject: 'meta-project.md',
  },
};

function loadKBFile(fileName: string): string {
  try {
    const kbPath = path.join(process.cwd(), KB_CONFIG.basePath, fileName);
    const content = fs.readFileSync(kbPath, 'utf-8');
    if (!content.trim()) {
      throw new ServiceError(`Knowledge base file ${fileName} is empty`);
    }
    return content;
  } catch (error) {
    if (error instanceof ServiceError) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new ServiceError(
      `Knowledge base file ${fileName} is missing or unreadable: ${detail}`
    );
  }
}

// KB files are static markdown that never change at runtime. Cache the joined
// result to eliminate 5 sync fs.readFileSync calls per POST /api/tailor-cv.
// The cache is invalidated only by resetKnowledgeBaseCacheForTest() (tests) or
// by container recycle (deploy) — the same lifetime as the file contents.
let cachedAllContext: string | null = null;

/** MVP path: load every KB file into the CV prompt. ~50–60k tokens, no selective RAG. */
export function getAllContext(): string {
  if (cachedAllContext !== null) return cachedAllContext;

  const fileNames = [
    KB_CONFIG.files.experience,
    KB_CONFIG.files.projects,
    KB_CONFIG.files.skills,
    KB_CONFIG.files.careerStory,
    KB_CONFIG.files.metaProject,
  ];

  const contexts = fileNames.map((fileName) => loadKBFile(fileName));
  const joined = contexts.join('\n\n--\n\n');
  cachedAllContext = joined;
  return joined;
}

/**
 * Clears the in-memory KB cache. Test-only — production callers must not use this;
 * the cache lifetime is intentionally tied to the container lifetime.
 */
export function resetKnowledgeBaseCacheForTest(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('resetKnowledgeBaseCacheForTest is only available in the test environment');
  }
  cachedAllContext = null;
}

