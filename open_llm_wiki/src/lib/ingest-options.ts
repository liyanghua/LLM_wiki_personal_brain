export type IngestQualityMode = "fast" | "balanced" | "full_quality"
export type StrategyCompileMode = "skip" | "deferred"

export interface AutoIngestOptions {
  batchId?: string
  deferPostProcessing?: boolean
  qualityMode?: IngestQualityMode
  strategyCompileMode?: StrategyCompileMode
  /**
   * Backward-compatible flag kept for older call sites. New code should use
   * strategyCompileMode so the UI can say explicitly whether strategyCompile
   * is skipped or deferred.
   */
  runStrategyEnhancement?: boolean
}

export function resolveStrategyCompileMode(
  options: Pick<AutoIngestOptions, "strategyCompileMode" | "runStrategyEnhancement" | "deferPostProcessing"> = {},
): StrategyCompileMode {
  if (options.strategyCompileMode) return options.strategyCompileMode
  if (options.runStrategyEnhancement === false) return "skip"
  if (options.runStrategyEnhancement === true) return "deferred"
  // Preserve the historical batch behavior unless the caller explicitly
  // chooses core extraction. SourcesView now passes "skip" by default.
  if (options.deferPostProcessing) return "deferred"
  return "deferred"
}

export function shouldRunStrategyCompileInCore(options: AutoIngestOptions = {}): boolean {
  const mode = resolveStrategyCompileMode(options)
  if (mode === "skip") return false
  return !options.deferPostProcessing
}

export function shouldRunDeferredStrategyCompile(options: AutoIngestOptions = {}): boolean {
  return resolveStrategyCompileMode(options) === "deferred"
}
