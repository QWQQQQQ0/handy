// Backward-compatible re-export barrel.
// The UnifiedAnalyzer implementation lives in services/analyzer/.
// See services/analyzer/index.ts for the full implementation.

export { unifiedAnalyzer } from './analyzer/index';
export type { LLMAnalysisResult, CoordinatePattern } from './analyzer/index';
