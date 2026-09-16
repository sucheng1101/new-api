package model

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"maps"
	"math"
	"slices"
	"sort"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// PricingValues is one model's configuration, keyed by the existing option
// names. A missing key inherits the engine's default; an explicit zero is free.
type PricingValues map[string]any

type ModelPricingChange struct {
	ModelName       string        `json:"model_name"`
	ExpectedVersion string        `json:"expected_version"`
	Pricing         PricingValues `json:"pricing"`
	Reset           bool          `json:"reset,omitempty"`
}

type ModelPricingEntry struct {
	ModelPricingDescription
	PluginAddons  []ModelPricingPluginAddon            `json:"plugin_addons,omitempty"`
	ModelName     string                               `json:"model_name"`
	Version       string                               `json:"version"`
	Configured    PricingValues                        `json:"configured"`
	UsageSchema   map[string]jsplugin.UsageFieldSchema `json:"usage_schema,omitempty"`
	UsageExamples []jsplugin.UsageExample              `json:"usage_examples,omitempty"`
}

// ModelPricingPluginAddon describes one actual task plugin's optional
// surcharge. The model-level expression remains the public base price; addon
// expressions can use the full plugin schema, such as Hailuo reference-media
// facts, and are only applied after this plugin has been selected.
type ModelPricingPluginAddon struct {
	PluginKey     string                               `json:"plugin_key"`
	PluginName    string                               `json:"plugin_name"`
	Icon          string                               `json:"icon,omitempty"`
	UsageSchema   map[string]jsplugin.UsageFieldSchema `json:"usage_schema"`
	UsageExamples []jsplugin.UsageExample              `json:"usage_examples,omitempty"`
	Configured    string                               `json:"configured"`
	Compatible    bool                                 `json:"compatible"`
	Stale         bool                                 `json:"stale,omitempty"`
}

type ModelPricingSnapshot struct {
	Entries      []ModelPricingEntry `json:"entries"`
	Options      map[string]string   `json:"options"`
	EmptyVersion string              `json:"empty_version"`
}

var ErrModelPricingConflict = errors.New("model pricing changed; reload before saving")

// Lock order is stable across instances. Creating missing option rows inside
// the transaction also serializes the first write to an unconfigured database.
var modelPricingOptionKeys = []string{
	"AudioCompletionRatio", "AudioRatio", "CacheRatio", "CompletionRatio",
	"CreateCacheRatio", "ImageRatio", "ModelPrice", "ModelRatio",
	"billing_setting.billing_expr", "billing_setting.billing_mode", billing_setting.PluginBillingAddonExprOption,
}

var modelPricingMutationMu sync.Mutex

func IsModelPricingOption(key string) bool {
	return slices.Contains(modelPricingOptionKeys, key)
}

func ModelPricingVersion(values PricingValues) string {
	encoded, _ := common.Marshal(values)
	return fmt.Sprintf("%x", sha256.Sum256(encoded))
}

func defaultPricingMaps() map[string]map[string]any {
	result := make(map[string]map[string]any, len(modelPricingOptionKeys))
	for _, key := range modelPricingOptionKeys {
		result[key] = make(map[string]any)
	}
	for key, values := range ratio_setting.GetDefaultPricingMaps() {
		for name, value := range values {
			result[key][name] = value
		}
	}
	return result
}

func readModelPricingMaps(db *gorm.DB) (map[string]map[string]any, map[string]bool, []string, error) {
	var rows []Option
	if err := db.Where(commonKeyCol+" IN ?", modelPricingOptionKeys).Find(&rows).Error; err != nil {
		return nil, nil, nil, err
	}
	values := defaultPricingMaps()
	existing := make(map[string]bool)
	counts := make(map[string]int)
	for _, row := range rows {
		var entries map[string]any
		if err := common.UnmarshalJsonStr(row.Value, &entries); err != nil {
			return nil, nil, nil, fmt.Errorf("%s: %w", row.Key, err)
		}
		if entries == nil {
			return nil, nil, nil, fmt.Errorf("%s must be a JSON object", row.Key)
		}
		values[row.Key] = entries
		existing[row.Key] = true
		counts[row.Key]++
	}
	var duplicated []string
	for _, key := range modelPricingOptionKeys {
		if counts[key] > 1 {
			duplicated = append(duplicated, key)
		}
	}
	return values, existing, duplicated, nil
}

func modelPricingValues(values map[string]map[string]any, name string) PricingValues {
	result := make(PricingValues)
	for _, key := range modelPricingOptionKeys {
		if key == billing_setting.PluginBillingAddonExprOption {
			addons := make(map[string]any)
			for variant, expression := range values[key] {
				if plugin, model, ok := billing_setting.SplitPluginBillingExprKey(variant); ok && model == name {
					addons[plugin] = expression
				}
			}
			if len(addons) > 0 {
				result[key] = addons
			}
			continue
		}
		if value, exists := values[key][name]; exists {
			result[key] = value
		}
	}
	return result
}

// replaceModelPricing writes one complete public-model draft into the option maps.
func replaceModelPricing(values map[string]map[string]any, name string, draft PricingValues) {
	for _, key := range modelPricingOptionKeys {
		if key == billing_setting.PluginBillingAddonExprOption {
			for variant := range values[key] {
				if _, model, ok := billing_setting.SplitPluginBillingExprKey(variant); ok && model == name {
					delete(values[key], variant)
				}
			}
			addons, _ := draft[key].(map[string]any)
			for plugin, expression := range addons {
				values[key][billing_setting.PluginBillingExprKey(plugin, name)] = expression
			}
			continue
		}
		delete(values[key], name)
		if value, exists := draft[key]; exists {
			values[key][name] = value
		}
	}
}

func effectiveModelPricing(values map[string]map[string]any, name string) PricingValues {
	result := modelPricingValues(values, name)
	// Legacy wildcard aliases are resolved by the same normalization as relay.
	alias := ratio_setting.FormatMatchingModelName(name)
	for _, key := range []string{"ModelPrice", "ModelRatio", "CompletionRatio", "AudioRatio", "AudioCompletionRatio"} {
		delete(result, key)
		if value, exists := values[key][alias]; exists {
			result[key] = value
		}
	}
	mode, _ := result["billing_setting.billing_mode"].(string)
	if mode == "" {
		_, hasPrice := result["ModelPrice"]
		_, hasRatio := result["ModelRatio"]
		if _, builtin := billing_setting.GetBuiltinBillingExpr(name); builtin && !hasPrice && !hasRatio {
			mode = "tiered_expr"
		}
	}
	if mode == "tiered_expr" {
		result["billing_setting.billing_mode"] = mode
		if _, exists := result["billing_setting.billing_expr"]; !exists {
			if expression, ok := billing_setting.GetBuiltinBillingExpr(name); ok {
				result["billing_setting.billing_expr"] = expression
			}
		}
		return result
	}
	if _, exists := result["ModelPrice"]; exists {
		return result
	}
	if _, exists := result["ModelRatio"]; !exists && operation_setting.SelfUseModeEnabled {
		result["ModelRatio"] = float64(37.5)
	}
	// Completion ratios include engine-enforced model defaults. Expose their
	// effective value without persisting them into the editable configuration.
	if ratio, exists := result["CompletionRatio"].(float64); exists {
		result["CompletionRatio"] = ratio
	} else {
		result["CompletionRatio"] = ratio_setting.GetCompletionRatio(name)
	}
	for key, fallback := range map[string]float64{
		"CacheRatio":       1.0,
		"CreateCacheRatio": 1.25,
		"ImageRatio":       1.0,
	} {
		if _, exists := result[key]; !exists {
			result[key] = fallback
		}
	}
	return result
}

// PreviewModelPricing resolves a complete editable draft using the same defaults
// as the saved-price display and conversion. It has no write side effects.
func PreviewModelPricing(name string, draft PricingValues) (PricingValues, error) {
	if draft == nil {
		return nil, errors.New("pricing draft is required")
	}
	values, _, _, err := readModelPricingMaps(DB)
	if err != nil {
		return nil, err
	}
	if err := validateModelPricing(name, draft, modelPricingValues(values, name)); err != nil {
		return nil, err
	}
	replaceModelPricing(values, name, draft)
	return effectiveModelPricing(values, name), nil
}

func GetModelPricingSnapshot(names []string) (*ModelPricingSnapshot, error) {
	values, _, _, err := readModelPricingMaps(DB)
	if err != nil {
		return nil, err
	}
	if len(names) == 0 {
		nameSet := make(map[string]bool)
		for optionKey, entries := range values {
			for name := range entries {
				if optionKey == billing_setting.PluginBillingAddonExprOption {
					_, publicModel, ok := billing_setting.SplitPluginBillingExprKey(name)
					if !ok {
						continue
					}
					name = publicModel
				}
				nameSet[name] = true
			}
		}
		for name := range billing_setting.GetBuiltinBillingExprCopy() {
			nameSet[name] = true
		}
		for name := range nameSet {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	result := &ModelPricingSnapshot{Entries: make([]ModelPricingEntry, 0, len(names)), Options: make(map[string]string), EmptyVersion: ModelPricingVersion(PricingValues{})}
	generation := jsplugin.DefaultRegistry.Generation()
	for _, name := range names {
		configured := modelPricingValues(values, name)
		entry := ModelPricingEntry{ModelName: name, Version: ModelPricingVersion(configured), Configured: configured,
			ModelPricingDescription: ModelPricingDescription{Effective: effectiveModelPricing(values, name)}}
		entry.CacheWriteMode = ResolveCacheWriteMode(name, configured)
		entry.BillingDetails = ResolveLegacyBillingDetails(name, entry.Effective, configured)
		entry.UsageSchema, entry.UsageExamples = modelPricingUsageContractForModel(generation, name)
		entry.PluginAddons = modelPricingPluginAddons(generation, name, configured)
		result.Entries = append(result.Entries, entry)
	}
	// Preserve the existing settings editor's full-map interface. Built-in
	// expressions are display defaults only; per-model writes do not persist them.
	for name, expression := range billing_setting.GetBuiltinBillingExprCopy() {
		effective := effectiveModelPricing(values, name)
		if effective["billing_setting.billing_mode"] != "tiered_expr" {
			continue
		}
		if _, ok := values["billing_setting.billing_mode"][name]; !ok {
			values["billing_setting.billing_mode"][name] = "tiered_expr"
		}
		if _, ok := values["billing_setting.billing_expr"][name]; !ok {
			values["billing_setting.billing_expr"][name] = expression
		}
	}
	for key, entries := range values {
		encoded, err := common.Marshal(entries)
		if err != nil {
			return nil, err
		}
		result.Options[key] = string(encoded)
	}
	return result, nil
}

// modelPricingUsageContractForModel resolves the task facts exposed by one
// public model. Direct registrations are combined because their user-facing
// price is shared; a mapping alias keeps the declared model profile of the
// selected plugin.
func modelPricingUsageContractForModel(generation *jsplugin.RoutingGeneration, modelName string) (map[string]jsplugin.UsageFieldSchema, []jsplugin.UsageExample) {
	if generation == nil || modelName == "" {
		return nil, nil
	}
	if plugins := generation.PluginsByModel(modelName); len(plugins) > 0 {
		return modelPricingUsageContract(plugins, modelName)
	}
	if target, ok := ResolveTaskModelAlias(generation, modelName); ok {
		if plugin, exists := generation.Get(target.PluginKey); exists {
			return plugin.Meta.UsageForModel(target.Declared)
		}
	}
	return nil, nil
}

type modelPricingPluginCandidate struct {
	plugin     *jsplugin.LoadedPlugin
	usageModel string
}

// modelPricingPluginCandidates returns the actual plugins that can execute a
// public model together with the profile spelling each one uses for facts.
// Direct declarations cover shared models such as MiniMax-H3; the alias branch
// keeps mapped-only task models editable as well.
func modelPricingPluginCandidates(generation *jsplugin.RoutingGeneration, modelName string) map[string]modelPricingPluginCandidate {
	candidates := make(map[string]modelPricingPluginCandidate)
	if generation == nil || modelName == "" {
		return candidates
	}
	for _, plugin := range generation.PluginsByModel(modelName) {
		if plugin == nil {
			continue
		}
		candidates[plugin.Meta.Key] = modelPricingPluginCandidate{
			plugin:     plugin,
			usageModel: plugin.Meta.UsageModelFor("", modelName),
		}
	}
	if len(candidates) > 0 {
		return candidates
	}
	if target, ok := ResolveTaskModelAlias(generation, modelName); ok {
		if plugin, exists := generation.Get(target.PluginKey); exists {
			candidates[plugin.Meta.Key] = modelPricingPluginCandidate{
				plugin:     plugin,
				usageModel: plugin.Meta.UsageModelFor(target.Declared, modelName),
			}
		}
	}
	return candidates
}

func modelPricingPluginAddons(generation *jsplugin.RoutingGeneration, modelName string, configured PricingValues) []ModelPricingPluginAddon {
	configuredAddons, _ := configured[billing_setting.PluginBillingAddonExprOption].(map[string]any)
	candidates := modelPricingPluginCandidates(generation, modelName)
	keys := make(map[string]bool, len(candidates)+len(configuredAddons))
	for key := range candidates {
		keys[key] = true
	}
	for key := range configuredAddons {
		keys[key] = true
	}
	if len(keys) == 0 {
		return nil
	}

	addons := make([]ModelPricingPluginAddon, 0, len(keys))
	for _, key := range slices.Sorted(maps.Keys(keys)) {
		configuredExpr, _ := configuredAddons[key].(string)
		candidate, exists := candidates[key]
		if !exists || candidate.plugin == nil {
			addon := ModelPricingPluginAddon{
				PluginKey: key, PluginName: key, Configured: configuredExpr,
				UsageSchema: map[string]jsplugin.UsageFieldSchema{}, Stale: true,
			}
			if plugin, loaded := generation.Get(key); loaded {
				addon.PluginName, addon.Icon = plugin.Meta.Name, plugin.Meta.Icon
			}
			addons = append(addons, addon)
			continue
		}
		schema, examples := modelPricingPluginAddonContract(
			generation,
			modelName,
			candidate,
		)
		addons = append(addons, ModelPricingPluginAddon{
			PluginKey:     candidate.plugin.Meta.Key,
			PluginName:    candidate.plugin.Meta.Name,
			Icon:          candidate.plugin.Meta.Icon,
			UsageSchema:   schema,
			UsageExamples: examples,
			Configured:    configuredExpr,
			Compatible:    configuredExpr == "" || billing_setting.TaskExprCompatible(configuredExpr, schema),
		})
	}
	return addons
}

// modelPricingPluginAddonContract exposes the facts that can price an
// executing plugin's add-on. Shared numeric facts remain in the public base
// price, but a plugin-specific meter may retain its own shared enum fields as
// selector dimensions. For example, Hailuo reference-media fees differ by the
// H3 768/2K tier without charging video duration a second time.
func modelPricingPluginAddonContract(generation *jsplugin.RoutingGeneration, modelName string, candidate modelPricingPluginCandidate) (map[string]jsplugin.UsageFieldSchema, []jsplugin.UsageExample) {
	if candidate.plugin == nil {
		return map[string]jsplugin.UsageFieldSchema{}, nil
	}
	pluginSchema, pluginExamples := candidate.plugin.Meta.UsageForModel(candidate.usageModel)
	publicSchema, _ := modelPricingUsageContractForModel(generation, modelName)
	addonSchema := make(map[string]jsplugin.UsageFieldSchema)
	hasPluginSpecificMeter := false
	for field, definition := range pluginSchema {
		if _, shared := publicSchema[field]; !shared {
			addonSchema[field] = definition
			hasPluginSpecificMeter = hasPluginSpecificMeter || modelPricingUsageFieldIsMeter(definition)
		}
	}
	if !hasPluginSpecificMeter {
		return map[string]jsplugin.UsageFieldSchema{}, nil
	}

	// An enum is only a selector in an add-on expression; it cannot introduce a
	// second quantity charge on its own. Keep the plugin's narrower enum rather
	// than the public union so Hailuo's H3 add-on exposes 768/2K, not Prompt
	// Hubs-only 1080p/4K rows.
	for field, definition := range pluginSchema {
		publicDefinition, shared := publicSchema[field]
		if !shared || len(definition.Enum) == 0 || !modelPricingUsageFieldsCompatible(definition, publicDefinition) {
			continue
		}
		addonSchema[field] = definition
	}

	examples := make([]jsplugin.UsageExample, 0, len(pluginExamples))
	for _, example := range pluginExamples {
		facts := make(map[string]any, len(addonSchema))
		for field := range addonSchema {
			if value, exists := example.Facts[field]; exists {
				facts[field] = value
			}
		}
		if len(facts) != len(addonSchema) {
			continue
		}
		examples = append(examples, jsplugin.UsageExample{
			Label: example.Label,
			Facts: facts,
		})
	}
	return addonSchema, examples
}

func modelPricingUsageFieldIsMeter(definition jsplugin.UsageFieldSchema) bool {
	return definition.Type == "number" && definition.Unit != ""
}

// modelPricingUsageContract combines the public model's declared task facts.
// A shared model has one public price expression, so only facts every serving
// plugin can provide are editable. Enum values are combined because a provider
// may support an additional valid variant of an otherwise shared fact.
func modelPricingUsageContract(plugins []*jsplugin.LoadedPlugin, modelName string) (map[string]jsplugin.UsageFieldSchema, []jsplugin.UsageExample) {
	type usageSource struct {
		schema   map[string]jsplugin.UsageFieldSchema
		examples []jsplugin.UsageExample
	}

	sources := make([]usageSource, 0, len(plugins))
	for _, plugin := range plugins {
		if plugin == nil {
			continue
		}
		pluginSchema, pluginExamples := plugin.Meta.UsageForModel(modelName)
		sources = append(sources, usageSource{schema: pluginSchema, examples: pluginExamples})
	}
	if len(sources) == 0 {
		return nil, nil
	}
	if len(sources) == 1 {
		return sources[0].schema, sources[0].examples
	}

	// Starting from the first schema makes shared-only fields explicit. A
	// Hailuo-only reference-media fact, for example, must not become a public
	// pricing input while Prompt Hubs cannot emit it.
	schema := cloneModelPricingUsageSchema(sources[0].schema)
	for _, source := range sources[1:] {
		for key, current := range schema {
			incoming, exists := source.schema[key]
			if !exists || !modelPricingUsageFieldsCompatible(current, incoming) {
				delete(schema, key)
				continue
			}
			schema[key] = mergeModelPricingUsageField(current, incoming)
		}
	}

	examples := make([]jsplugin.UsageExample, 0)
	seenExamples := make(map[string]struct{})
	for _, source := range sources {
		for _, example := range source.examples {
			if !modelPricingUsageExampleMatchesSchema(example, schema) {
				continue
			}
			identity, _ := common.Marshal(example)
			if _, exists := seenExamples[string(identity)]; exists {
				continue
			}
			seenExamples[string(identity)] = struct{}{}
			examples = append(examples, example)
		}
	}
	return schema, examples
}

func cloneModelPricingUsageSchema(schema map[string]jsplugin.UsageFieldSchema) map[string]jsplugin.UsageFieldSchema {
	cloned := make(map[string]jsplugin.UsageFieldSchema, len(schema))
	for key, field := range schema {
		field.Enum = slices.Clone(field.Enum)
		field.Description = maps.Clone(field.Description)
		field.UnitLabel = maps.Clone(field.UnitLabel)
		if field.EnumLabels != nil {
			labels := make(map[string]jsplugin.LocalizedText, len(field.EnumLabels))
			for value, label := range field.EnumLabels {
				labels[value] = maps.Clone(label)
			}
			field.EnumLabels = labels
		}
		cloned[key] = field
	}
	return cloned
}

func modelPricingUsageFieldsCompatible(left, right jsplugin.UsageFieldSchema) bool {
	if left.Type != right.Type || left.Unit != right.Unit {
		return false
	}
	return (len(left.Enum) > 0) == (len(right.Enum) > 0)
}

func modelPricingUsageExampleMatchesSchema(example jsplugin.UsageExample, schema map[string]jsplugin.UsageFieldSchema) bool {
	if len(example.Facts) != len(schema) {
		return false
	}
	for field := range example.Facts {
		if _, exists := schema[field]; !exists {
			return false
		}
	}
	return true
}

func mergeModelPricingUsageField(left, right jsplugin.UsageFieldSchema) jsplugin.UsageFieldSchema {
	if len(right.Enum) > 0 {
		seen := make(map[string]struct{}, len(left.Enum)+len(right.Enum))
		merged := make([]string, 0, len(left.Enum)+len(right.Enum))
		for _, value := range append(append([]string{}, left.Enum...), right.Enum...) {
			if _, exists := seen[value]; exists {
				continue
			}
			seen[value] = struct{}{}
			merged = append(merged, value)
		}
		left.Enum = merged
	}
	if left.Description == nil {
		left.Description = right.Description
	}
	if left.UnitLabel == nil {
		left.UnitLabel = maps.Clone(right.UnitLabel)
	}
	if len(right.EnumLabels) > 0 {
		labels := make(map[string]jsplugin.LocalizedText, len(left.EnumLabels)+len(right.EnumLabels))
		for value, label := range left.EnumLabels {
			labels[value] = maps.Clone(label)
		}
		for value, label := range right.EnumLabels {
			if _, exists := labels[value]; !exists {
				labels[value] = maps.Clone(label)
			}
		}
		left.EnumLabels = labels
	}
	return left
}

func ValidateModelPricing(name string, values PricingValues) error {
	previous := PricingValues{}
	addons := make(map[string]any)
	for key, expression := range billing_setting.GetPluginBillingAddonExprCopy() {
		if plugin, model, ok := billing_setting.SplitPluginBillingExprKey(key); ok && model == name {
			addons[plugin] = expression
		}
	}
	if len(addons) > 0 {
		previous[billing_setting.PluginBillingAddonExprOption] = addons
	}
	if expression, ok := billing_setting.GetBillingExpr(name); ok {
		previous["billing_setting.billing_expr"] = expression
	}
	return validateModelPricing(name, values, previous)
}

// Writes pass the locked database snapshot here, so allowing an unchanged stale
// override cannot bypass validation through an out-of-date process-local cache.
func validateModelPricing(name string, values, previous PricingValues) error {
	if strings.TrimSpace(name) == "" {
		return errors.New("model name is required")
	}
	generation := jsplugin.DefaultRegistry.Generation()
	previousAddons, _ := previous[billing_setting.PluginBillingAddonExprOption].(map[string]any)
	addons := map[string]any{}
	if value, exists := values[billing_setting.PluginBillingAddonExprOption]; exists {
		var ok bool
		addons, ok = value.(map[string]any)
		if !ok || addons == nil {
			return errors.New("plugin billing addon expressions must be a plugin-to-expression object")
		}
		candidates := modelPricingPluginCandidates(generation, name)
		for pluginKey, value := range addons {
			expression, ok := value.(string)
			if !ok || strings.TrimSpace(expression) == "" {
				return fmt.Errorf("model %s: plugin %s: addon billing expression is required", name, pluginKey)
			}
			candidate, exists := candidates[pluginKey]
			if !exists || candidate.plugin == nil {
				if previousAddons[pluginKey] == expression {
					continue
				}
				return fmt.Errorf("model %s: plugin %s does not declare this model", name, pluginKey)
			}
			schema, _ := modelPricingPluginAddonContract(generation, name, candidate)
			if len(schema) == 0 {
				return fmt.Errorf("model %s: plugin %s has no plugin-specific usage facts for an addon price", name, pluginKey)
			}
			if err := billing_setting.SmokeTestTaskExpr(expression, schema); err != nil {
				return fmt.Errorf("model %s: plugin %s addon: %w", name, pluginKey, err)
			}
		}
	}
	for key, value := range values {
		if !IsModelPricingOption(key) {
			return fmt.Errorf("unsupported pricing field: %s", key)
		}
		if key == billing_setting.PluginBillingAddonExprOption {
			continue
		}
		if key == "billing_setting.billing_mode" {
			if value != "ratio" && value != "tiered_expr" {
				return errors.New("invalid billing mode")
			}
			continue
		}
		if key == "billing_setting.billing_expr" {
			expression, ok := value.(string)
			if !ok || strings.TrimSpace(expression) == "" {
				return errors.New("billing expression is required")
			}
			// The public expression is limited to facts shared by every plugin.
			// Plugin-only facts are validated in the additive expression above.
			if _, err := billingexpr.CompileFromCache(expression); err != nil {
				return fmt.Errorf("model %s: %w", name, err)
			}
			var err error
			if schema, _ := modelPricingUsageContractForModel(generation, name); len(schema) > 0 {
				err = billing_setting.SmokeTestTaskExpr(expression, schema)
			} else if previous[key] != expression || len(billingexpr.UsedUsageKeys(expression)) == 0 {
				err = billing_setting.SmokeTestExpr(expression)
			}
			// With no remaining plugin, an unchanged stored usage expression has
			// no schema to test. Preserve it so removing stale overrides or saving
			// other model prices does not become impossible.
			if err != nil {
				return fmt.Errorf("model %s: %w", name, err)
			}
			continue
		}
		number, ok := value.(float64)
		if !ok || math.IsNaN(number) || math.IsInf(number, 0) || number < 0 {
			return fmt.Errorf("%s must be a finite, non-negative number", key)
		}
	}
	if values["billing_setting.billing_mode"] == "tiered_expr" {
		if _, exists := values["billing_setting.billing_expr"]; !exists {
			if _, builtin := billing_setting.GetBuiltinBillingExpr(name); !builtin {
				return errors.New("billing expression is required")
			}
		}
	}
	return nil
}

func UpdateModelPricing(changes []ModelPricingChange) error {
	if len(changes) == 0 {
		return errors.New("select model pricing changes before saving")
	}
	seen := make(map[string]bool)
	for _, change := range changes {
		if seen[change.ModelName] {
			return errors.New("duplicate model pricing change")
		}
		seen[change.ModelName] = true
		if change.ExpectedVersion == "" {
			return ErrModelPricingConflict
		}
	}
	return mutateModelPricingOptions(func(_ *gorm.DB, values map[string]map[string]any) error {
		defaults := defaultPricingMaps()
		for _, change := range changes {
			previous := modelPricingValues(values, change.ModelName)
			if ModelPricingVersion(previous) != change.ExpectedVersion {
				return fmt.Errorf("%w: %s", ErrModelPricingConflict, change.ModelName)
			}
			pricing := change.Pricing
			if change.Reset {
				pricing = modelPricingValues(defaults, change.ModelName)
			}
			if err := validateModelPricing(change.ModelName, pricing, previous); err != nil {
				return err
			}
			replaceModelPricing(values, change.ModelName, pricing)
		}
		return nil
	})
}

// UpdateModelPricingOptions keeps legacy single-option callers on the same
// locking, validation and transaction path as the model-level API.
func UpdateModelPricingOptions(updates map[string]string) error {
	return mutateModelPricingOptions(func(_ *gorm.DB, values map[string]map[string]any) error {
		previous := maps.Clone(values)
		names := make(map[string]bool)
		for key, raw := range updates {
			if !IsModelPricingOption(key) {
				return fmt.Errorf("unsupported pricing field: %s", key)
			}
			var entries map[string]any
			if err := common.UnmarshalJsonStr(raw, &entries); err != nil {
				return err
			}
			if entries == nil {
				return fmt.Errorf("%s must be a JSON object", key)
			}
			for _, entriesForKey := range []map[string]any{values[key], entries} {
				for name := range entriesForKey {
					if key == billing_setting.PluginBillingAddonExprOption {
						_, model, ok := billing_setting.SplitPluginBillingExprKey(name)
						if !ok {
							return fmt.Errorf("invalid plugin billing addon expression key: %s", name)
						}
						name = model
					}
					names[name] = true
				}
			}
			values[key] = entries
		}
		for name := range names {
			if err := validateModelPricing(name, modelPricingValues(values, name), modelPricingValues(previous, name)); err != nil {
				return err
			}
		}
		return nil
	})
}

func mutateModelPricingOptions(mutate func(*gorm.DB, map[string]map[string]any) error) error {
	modelPricingMutationMu.Lock()
	defer modelPricingMutationMu.Unlock()
	var committed map[string]map[string]any
	err := DB.Transaction(func(tx *gorm.DB) error {
		values, existing, duplicated, err := readModelPricingMaps(lockForUpdate(tx))
		if err != nil {
			return err
		}
		if len(duplicated) > 0 {
			common.SysError("options table has duplicate pricing keys [" + strings.Join(duplicated, ", ") + "]; the table is missing a primary key")
		}
		defaults := defaultPricingMaps()
		for _, key := range modelPricingOptionKeys {
			if existing[key] {
				continue
			}
			encoded, err := common.Marshal(defaults[key])
			if err != nil {
				return err
			}
			row := Option{Key: key, Value: string(encoded)}
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error; err != nil {
				return err
			}
		}
		if err := mutate(tx, values); err != nil {
			return err
		}
		for _, key := range modelPricingOptionKeys {
			encoded, err := common.Marshal(values[key])
			if err != nil {
				return err
			}
			if err := tx.Model(&Option{}).Where(commonKeyCol+" = ?", key).Update("value", string(encoded)).Error; err != nil {
				return err
			}
		}
		committed = values
		return nil
	})
	if err != nil {
		return err
	}
	for _, key := range modelPricingOptionKeys {
		encoded, _ := common.Marshal(committed[key])
		if err := updateOptionMap(key, string(encoded)); err != nil {
			return err
		}
	}
	RefreshPricing()
	ratio_setting.InvalidateExposedDataCache()
	return nil
}
