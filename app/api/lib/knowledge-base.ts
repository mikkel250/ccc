import fs from 'fs';
import path from 'path';

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
    return fs.readFileSync(kbPath, 'utf-8');
  } catch (error) {
    console.error(`Error loading KB file ${fileName}:`, error);
    return '';
  }
}

function isExperienceQuery(query: string): boolean {
  const experienceKeywords = /experience|work|job|role|position|company|companies|employer|career|professional|worked at|job history|background/i;
  return experienceKeywords.test(query);
}

function isProjectsQuery(query: string): boolean {
  const projectKeywords = /project|built|created|developed|portfolio|github|demo|app|application|website|site|outside of work|independant|open source/i;
  return projectKeywords.test(query);
}

function isSkillsQuery(query: string): boolean {
  const skillKeywords = /skill|technology|tech stack|know|familiar|proficient|expertise|experienced with|languages?|frameworks?|tools?|libraries|typescript|javascript|react|angular|python|node/i;
  return skillKeywords.test(query);
}

function isCareerStoryQuery(query: string): boolean {
  const careerStoryKeywords = /why|transition|switch|career change|background|story|journey|path|how did you|what led you|management|previous|before/i;
  return careerStoryKeywords.test(query);
}

function isMetaQuery(query: string): boolean {
  const metaKeywords = /AI|assistant|chatbot|this (app|tool|bot|system)|how (does this|do you) work|built this|created this|tech stack|architecture|GPT|OpenAI|how are you|agentic|agent|autonomous|LLM|machine learning|prompt engineering/i;
  return metaKeywords.test(query);
}

// Job description detection function (server-side only)
function isJobDescriptionQuery(query: string): boolean {
  // Simplified JD detection - only the most obvious indicators
  const obviousJD = [
    /responsibilities:/i,
    /requirements:/i,
    /qualifications:/i,
    /required skills/i,
    /must have:/i,
    /preferred skills/i,
    /years of experience/i,
    /bonus points/i,
    /preferred qualifications/i,
    /nice to have/i,
    /minimum qualifications:/i,
    /you'll be working on/i,
    /about the role/i,
    /experience with the following technologies/i,
    /JD/i,
    /job description/i,
    /opportunity/i,
  ];
  
  const matchCount = obviousJD.filter(pattern => pattern.test(query)).length;
  
  // Require at least 2 JD indicators to reduce false positives from casual outreach
  return query.length > 150 && matchCount >= 2;
}

export function getRelevantContext(query: string): string {
  const contexts: string[] = [];

  if (isJobDescriptionQuery(query)) {
    contexts.push(loadKBFile(KB_CONFIG.files.experience));
    contexts.push(loadKBFile(KB_CONFIG.files.skills));
    contexts.push(loadKBFile(KB_CONFIG.files.projects));
    contexts.push(loadKBFile(KB_CONFIG.files.careerStory));
    return contexts.filter(context => context.length > 0).join('\n\n--\n\n'); // separate the sections so LLM knows they are different
  }

  if (isExperienceQuery(query)) {
    contexts.push(loadKBFile(KB_CONFIG.files.experience));
  }

  if (isProjectsQuery(query)) {
    contexts.push(loadKBFile(KB_CONFIG.files.projects));
  }

  if (isSkillsQuery(query)) {
    contexts.push(loadKBFile(KB_CONFIG.files.skills));
  }

  if (isCareerStoryQuery(query)) {
    contexts.push(loadKBFile(KB_CONFIG.files.careerStory));
  }

  if (isMetaQuery(query)) {
    contexts.push(loadKBFile(KB_CONFIG.files.metaProject));
  }

  if (contexts.length === 0) {
    contexts.push(loadKBFile(KB_CONFIG.files.experience));
    contexts.push(loadKBFile(KB_CONFIG.files.skills));
  }

  return contexts.filter(context => context.length > 0).join('\n\n--\n\n');
}

export function getAllContext(): string {
  const contexts = [
    loadKBFile(KB_CONFIG.files.experience),
    loadKBFile(KB_CONFIG.files.projects),
    loadKBFile(KB_CONFIG.files.skills),
    loadKBFile(KB_CONFIG.files.careerStory),
    loadKBFile(KB_CONFIG.files.metaProject),
  ];

  return contexts.filter(context => context.length > 0).join('\n\n--\n\n');
}

export function extractJobTitle(query: string): string | null {
  const patterns = [
    // Match titles like "Frontend Software Engineer", "UI/UX Developer", "AI Engineer", etc.
    /(?:seeking|hiring|looking for|impressed by your skills|interested in|good fit for|great match)\s+(?:a\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Software\s+)?(?:Engineer|Developer|Architect|Manager|Lead))/,
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Software\s+)?(?:Engineer|Developer|Architect|Manager|Lead))\s+(?:role|position|job)/,
    // Specific patterns for common titles
    /(?:seeking|hiring|looking for|impressed by your skills|interested in|good fit for|great match)\s+(?:a\s+)?(Frontend\s+(?:Software\s+)?(?:Engineer|Developer))/,
    /(?:seeking|hiring|looking for|impressed by your skills|interested in|good fit for|great match)\s+(?:a\s+)?(Full\s+Stack\s+(?:Software\s+)?(?:Engineer|Developer))/,
    /(?:seeking|hiring|looking for|impressed by your skills|interested in|good fit for|great match)\s+(?:a\s+)?(UI\/UX\s+(?:Engineer|Developer))/,
    /(?:seeking|hiring|looking for|impressed by your skills|interested in|good fit for|great match)\s+(?:a\s+)?(AI\s+(?:Engineer|Developer))/,
    /(?:seeking|hiring|looking for|impressed by your skills|interested in|good fit for|great match)\s+(?:a\s+)?(Web\s+(?:Engineer|Developer))/,
    /(?:seeking|hiring|looking for|impressed by your skills|interested in|good fit for|great match)\s+(?:a\s+)?(React\s+(?:Engineer|Developer))/,
    /(?:seeking|hiring|looking for|impressed by your skills|interested in|good fit for|great match)\s+(?:a\s+)?(Angular\s+(?:Engineer|Developer))/,
    /(?:seeking|hiring|looking for|impressed by your skills|interested in|good fit for|great match)\s+(?:a\s+)?(JavaScript\s+(?:Engineer|Developer))/,
    /(?:seeking|hiring|looking for|impressed by your skills|interested in|good fit for|great match)\s+(?:a\s+)?(TypeScript\s+(?:Engineer|Developer))/,
  ];

  for (const pattern of patterns) {
    const match = query.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}


// Job filtering functions moved to lib/input-filter.ts to avoid fs import issues on client side
