// Input validation and filtering to prevent BS being sent to the AI
// Client-safe job filtering functions (without fs imports)

export interface FilterResult {
  shouldCallAPI: boolean;
  response?: string;
  reason?: string;
}

export interface JobFilterResult {
  shouldProceed: boolean;
  response?: string;
  reason?: string;
}

// Client-safe job filtering functions (moved from knowledge-base.ts to avoid fs imports)
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
    /\bJD\b/i,
    /job description/i,
    /\bopportunity\b/i,
  ];
  
  const matchCount = obviousJD.filter(pattern => pattern.test(query)).length;
  
  // Require at least 2 JD indicators to reduce false positives from casual outreach
  return query.length > 150 && matchCount >= 2;
}

function isJobRelatedQuery(query: string): boolean {
  // Word boundaries on short tokens that are easy substring matches otherwise
  // (e.g. "role" in "console", "office" in "backoffice" only matches as its own word).
  const jobRelatedKeywords = [
    /\b(job|position|role|opportunity|hiring|recruiting)\b/i,
    /\b(salary|compensation|pay|rate|range)\b/i,
    /\b(location|remote|hybrid|onsite|office)\b/i,
    /\b(work authorization|visa|citizen|sponsor|sponsorship)\b/i,
    /\b(relocation|relocate)\b/i,
  ];

  return jobRelatedKeywords.some((pattern) => pattern.test(query));
}

function checkWorkAuthorizationQuery(query: string): JobFilterResult {
  // Check for various work authorization related patterns
  const authPatterns = [
    /work authorization/i,
    /authorized.*work/i,
    /authorized.*the/i,
    /eligible to work/i,
    /us citizen/i,
    /\bauthorized\b/i,
    /visa sponsorship/i,
    /sponsor.*visa/i,
    /need.*sponsorship/i,
    /require.*sponsorship/i,
    /require.*visa/i
  ];

  const hasAuthPattern = authPatterns.some(pattern => pattern.test(query));
  
  if (hasAuthPattern) {
    if (query.length >= 200) {
      return { shouldProceed: true };
    }

    return {
      shouldProceed: false,
      response: "Mikkel is authorized to work in the United States and does not require visa sponsorship.",
      reason: "work_authorization"
    };
  }
  

  return { shouldProceed: true };
}

function checkSalaryQuery(query: string): JobFilterResult {
  // Only catch explicit salary/compensation questions, not job descriptions
  const salaryQuestionPatterns = [
    /\bwhat's?\s+(your|your salary|your compensation|your pay|your rate)\b/i,
    /\bhow much\b/i,
    /\bsalary expectation/i,
    /\bcompensation expectation/i,
    /\bpay expectation/i,
    /\bsalary range/i,
    /\bcompensation range/i,
    /\bwhat.*salary/i,
    /\bwhat.*compensation/i,
    /\bwhat.*pay/i
  ];
  
  // Only trigger for questions, not for job descriptions that might mention these terms
  const isSalaryQuestion = salaryQuestionPatterns.some(pattern => pattern.test(query));
  
  if (isSalaryQuestion && query.length < 200) { // Avoid matching job descriptions
    return {
      shouldProceed: false,
      response: "Mikkel would be happy to discuss compensation expectations once there's a conversation about the role and opportunity. His absolute minimum expectation is that the pay is equivalent to a living wage for someone living and paying rent in downtown San Francisco. Please feel free to reach out if you'd like to learn more about his background and experience!",
      reason: "salary_query"
    };
  }
  
  return { shouldProceed: true };
}

function checkRoleMatch(query: string): JobFilterResult {
  // First, check if this is clearly a software engineering role
  // If it contains strong software engineering indicators, skip role filtering
  const softwareEngineeringIndicators = [
    /\b(engineer|developer|programmer|software|frontend|backend|full.?stack|fullstack)/i,
    /\b(sdk|api|react|typescript|javascript|node|python|java|go|rust)/i,
    /\b(code|programming|coding|development|infrastructure|devops)/i,
    /\b(technical|tech stack|tech stack|architecture|system design)/i,
  ];
  
  const hasSoftwareEngineeringIndicators = softwareEngineeringIndicators.some(pattern => pattern.test(query));
  
  // If it has strong software engineering indicators, don't filter it out
  // This prevents false positives from terms like "delivery" in "CI/CD & Delivery"
  if (hasSoftwareEngineeringIndicators) {
    return { shouldProceed: true };
  }
  
  // Only filter out obviously non-matching roles, let AI handle nuanced matching
  // These are roles that are clearly not software engineering
  // Made patterns more specific to avoid false positives (e.g., "delivery driver" not just "delivery")
  const nonMatchingRoles = [
    /\b(medical doctor|physician|surgeon|nurse|healthcare provider)/i,
    /\b(teacher|professor|educator|instructor)/i,
    /\b(lawyer|attorney|legal counsel)/i,
    /\b(accountant|cpa|finance|bookkeeper)/i,
    /\b(pilot|flight attendant|delivery driver|truck driver|uber driver|taxi driver|bus driver)/i,
    /\b(chef|cook|restaurant|food service)/i,
    /\b(retail|cashier|sales associate)/i,
    /\b(construction|contractor|plumber|electrician)/i,
  ];
  
  // Check if this is a job posting AND has non-matching role keywords
  const isNonMatchingRole = nonMatchingRoles.some(pattern => pattern.test(query));
  
  // Only filter if it's clearly a job posting with non-matching role
  if ((isJobDescriptionQuery(query) || isJobRelatedQuery(query)) && isNonMatchingRole) {
    return {
      shouldProceed: false,
      response: "Thank you for reaching out. This position doesn't align with Mikkel's background as a software engineer, as he's focused on opportunities in software development. He would have to decline this one. Thanks for thinking of him!",
      reason: "role_mismatch"
    };
  }
  
  return { shouldProceed: true };
}

function checkLocationQuery(query: string): FilterResult {
  // Tight phrasing + word boundaries: avoid "where the office is located",
  // "based on X in Y", "olive oil in …", and bare "location" inside words like "collocation".
  const locationPatterns = [
    /\bwhere\b.{0,160}?\b(he|mikkel)\b.{0,160}?\b(located|living|lives\s+in|live\s+in|live)\b/i,
    /\bwhere\s+(is|does)\s+(he|mikkel)\b/i,
    /\bwhere\b.{0,80}?\b(is|does)\s+mikkel\b/i,
    /\bwhere\b.{0,120}?\b(is|does)\s+(he|mikkel)\b.{0,120}?\blive\b/i,
    /\blocation\b/i,
    /\bbased\s+in\b/i,
    /\b(lives?|living)\s+in\b/i,
    /\bfrom\s+(where|what\s+city)\b/i,
  ];

  const hasLocationPattern = locationPatterns.some((pattern) => pattern.test(query));
  
  if (hasLocationPattern) {
    if (query.length >= 200) {
      return { shouldCallAPI: true };
    }
    
    return {
      shouldCallAPI: false,
      response: "Mikkel is located in San Francisco, CA. His recent roles at SFMOMA and Intrinsic (Alphabet/Google) were hybrid rolesbased in San Francisco Bay Area, and he also has extensive experience working effectively in fully remote environments for companies like Jefferson Health. He is also open to fully onsite roles, with preference for geographical proximity to downtown San Francisco.",
      reason: "location_query"
    };
  }
  
  return { shouldCallAPI: true };
}

function checkWorkArrangementQuery(query: string): FilterResult {
  // Check for work arrangement questions (W2, Contract, C2C, etc.)
  const workArrangementPatterns = [
    /\b(w2|w-2|w\s*2)\b/i,
    /\b(c2c|c-2-c|corp.*to.*corp|corp.*corp)\b/i,
    /\bcontract(.*arrangement)?\b/i,
    // Require "work arrangement" / "employment arrangement" as phrases — not "at work … arrangement …"
    /\b(employment|work)\s+arrangement\b/i,
    /\bcan\s+he\s+work\b.{0,80}?\b(w2|c2c|contract)\b/i,
    /\b(work|available)\s+on\s+(a\s+)?(w2|c2c|contract)\b/i,
    /\b(w2|c2c|contract)\s+arrangement\b/i,
    /\bsole\s+proprietorship\b/i,
    /\bbilling\s+directly\b/i,
    /\b1099\b/i,
    /\bfull[\s-]*time\b/i,
    // Match FTE/FTA only as whole tokens — bare /ft[ae]/ matches "fte" inside "after"
    /\bft[ae]\b/i,
  ];

  const hasWorkArrangementPattern = workArrangementPatterns.some((pattern) =>
    pattern.test(query),
  );
  
  if (hasWorkArrangementPattern) {
    if (query.length >= 200) {
      return { shouldCallAPI: true};
    }

    return {
      shouldCallAPI: false,
      response: "Mikkel is flexible with work arrangements and has experience with multiple employment setups:\n\n**Full-time/Salary**: He is open to full-time salaried positions and has experience in both traditional employment and contract roles.\n\n**Contract**: He can work in all three types of contract arrangements:\n- **W2 Contract**: Standard W2 contractor arrangements\n- **1099**: Independent contractor (1099) arrangements\n- **C2C (Corp-to-Corp)**: Yes, he can work on a C2C basis.\n\nArrangements other than W2 would involve a 25% higher rate since he is paying all taxes, benefits, and unpaid time off on that income, this is the minimum increase to account for that difference.\n\nNote: While he can work in all three contract types, if C2C is a hard requirement, he would need to discuss the details of this arrangement directly with the client.\n\nHis background includes successful long and short-term contracts at major organizations like Intrinsic (Alphabet/Google) for 5 months and Jefferson Health, where an initial 4-month contract was extended to 1 year and 2 months due to outstanding performance.",
      reason: "work_arrangement_query"
    };
  }
  
  return { shouldCallAPI: true };
}

export function filterJobCriteria(query: string): JobFilterResult {
  // Check if this is a job-related query
  if (!isJobDescriptionQuery(query) && !isJobRelatedQuery(query)) {
    return { shouldProceed: true };
  }

  // Check for work authorization questions
  const authResult = checkWorkAuthorizationQuery(query);
  if (!authResult.shouldProceed) {
    return authResult;
  }

  // Check for salary questions
  const salaryResult = checkSalaryQuery(query);
  if (!salaryResult.shouldProceed) {
    return salaryResult;
  }

  // Check for obviously non-matching role titles
  const roleResult = checkRoleMatch(query);
  if (!roleResult.shouldProceed) {
    return roleResult;
  }

  return { shouldProceed: true };
}

export function filterInput(query: string, conversationHistory: string[]): FilterResult {
  const trimmed = query.trim();
  
  // Check job-specific criteria first
  const jobFilterResult = filterJobCriteria(query);
  if (!jobFilterResult.shouldProceed) {
    return {
      shouldCallAPI: false,
      response: jobFilterResult.response,
      reason: jobFilterResult.reason
    };
  }
  
  // Check for location queries (short-circuit to avoid API calls)
  const locationResult = checkLocationQuery(query);
  if (!locationResult.shouldCallAPI) {
    return locationResult;
  }
  
  // Check for work arrangement queries (short-circuit to avoid API calls)
  const workArrangementResult = checkWorkArrangementQuery(query);
  if (!workArrangementResult.shouldCallAPI) {
    return workArrangementResult;
  }
  
  // first, check if it's an answer to a question/CTA from the LLM 
  if (conversationHistory && conversationHistory.length > 0) {
    const lastMessage = conversationHistory[conversationHistory.length - 1];

    // if the last message was a question and this is a short response, allow it
    if (lastMessage.includes('?') && trimmed.length <= 10) {
      return {
        shouldCallAPI: true,
        reason: 'valid_follow_up'
      }
    }
  }

  // too short
  if (trimmed.length <= 10) {
    return {
      shouldCallAPI: false,
      response: "Sorry, I don't understand the question or message. Please try to formulate a complete and valid question or message (ideally a full sentence) and I'll be happy to provide you with a complete answer!",
      reason: "too_short"
    };
  }

  // spam/keyboard mash filter - only check for 4+ repeated letters (actual keyboard mashing)
  // Skip this check for long messages (likely legitimate content like job descriptions)
  if (trimmed.length <= 200 && /([a-zA-Z])\1{3,}/.test(trimmed)) {
    return {
      shouldCallAPI: false,
      response: "This seems like an invalid input, please ask a complete question.",
      reason: "repeated_chars"
    };
  }

  // specific keyboard mash patterns - only check short inputs (long content is likely legitimate)
  if (trimmed.length <= 200) {
    const keyboardPatterns = [
      /asdfg/i,
      /qwerty/i,
      /zxcvb/i,
      /mnbvc/i,
      /poiuyt/i,
      /lkjhgf/i,
      /^[a-z]{1,2}$/i,
    ];

    if (keyboardPatterns.some(pattern => pattern.test(trimmed))) {
      return {
        shouldCallAPI: false,
        response: "Invalid input detected, please ask a complete question or try formulating it again.",
        reason: "keyboard_mash"
      };
    }
  }

  // generic queries - provide helpful canned response but don't call API
  const genericPatterns = [
    /^(tell me about|about mikkel|about him)$/i,
    // Greetings that slip through the length filter
    /^(hi|hello|hey|yo|howdy|greetings)[\s,!.]+$/i,
    /^(what's up|whats up|sup)[\s,!.]*$/i,
    
    // Vague queries without context
    /^(tell me more|say more|continue|go on)[\s,!.]*$/i,
    /^(what about you|about you|you\?)[\s,!.]*$/i,
    /^(more info|more information)[\s,!.]*$/i,
  ];

  if (genericPatterns.some(pattern => pattern.test(trimmed))) {
    return {
      shouldCallAPI: false,
      response: `Mikkel is a software engineer with ~6 years of experience, including TypeScript, React, Node.js, ASP.NET, and Shopify expertise. 

What specific area would you like to explore?
- Ask about his **experience** at specific companies
- Ask about his **projects** and accomplishments  
- Ask about **skills** in particular technologies
- Or **paste a full job description** for detailed match analysis`,
      reason: 'generic_query'
    };
  }

  // all queries not caught above get sent to the API 
  return { shouldCallAPI: true };
}