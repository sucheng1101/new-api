package ratio_setting

import "maps"

// GetDefaultPricingMaps returns independent copies of the built-in model
// pricing maps. Model-level snapshots use these values for reset and
// first-write initialization.
func GetDefaultPricingMaps() map[string]map[string]float64 {
	defaults := map[string]map[string]float64{
		"ModelPrice":           defaultModelPrice,
		"ModelRatio":           defaultModelRatio,
		"CompletionRatio":      defaultCompletionRatio,
		"CacheRatio":           defaultCacheRatio,
		"CreateCacheRatio":     defaultCreateCacheRatio,
		"ImageRatio":           defaultImageRatio,
		"AudioRatio":           defaultAudioRatio,
		"AudioCompletionRatio": defaultAudioCompletionRatio,
	}
	result := make(map[string]map[string]float64, len(defaults))
	for key, values := range defaults {
		result[key] = make(map[string]float64, len(values))
		maps.Copy(result[key], values)
	}
	return result
}
