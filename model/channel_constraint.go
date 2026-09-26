package model

import (
	"slices"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
)

var filterEvalOrder = []dto.ChannelFilterKind{dto.FilterRequestPath, dto.FilterTaskPluginIdentity}

// ChannelSatisfiesFilters reports whether a channel passes all request filters.
func ChannelSatisfiesFilters(ch *Channel, modelName string, filters []dto.ChannelFilter) (bool, dto.ChannelFilterKind) {
	if ch == nil {
		return false, ""
	}
	for _, kind := range filterEvalOrder {
		for _, filter := range filters {
			if filter.Kind == kind && !channelMatchesFilter(ch, modelName, filter) {
				return false, kind
			}
		}
	}
	return true, ""
}

func channelMatchesFilter(ch *Channel, modelName string, filter dto.ChannelFilter) bool {
	switch filter.Kind {
	case dto.FilterRequestPath:
		// The fork does not have the official Advanced Custom channel type.
		// Keep this filter kind forward-compatible while leaving legacy routing
		// unchanged on this branch.
		return true
	case dto.FilterTaskPluginIdentity:
		if ch.Type == constant.ChannelTypeTaskPlugin {
			channelPluginKey := ch.GetSetting().TaskPluginKey
			if len(filter.TaskPluginKeys) > 0 {
				return slices.Contains(filter.TaskPluginKeys, channelPluginKey)
			}
			return filter.TaskPluginKey != "" && channelPluginKey == filter.TaskPluginKey
		}
		if len(filter.TaskPluginChannelTypes) > 0 {
			return slices.Contains(filter.TaskPluginChannelTypes, ch.Type)
		}
		// An empty identity filter is a no-op for ordinary requests. A task
		// endpoint with multiple plugin candidates always supplies either plugin
		// keys or legacy channel types above, so it cannot leak into this branch.
		return filter.TaskPluginKey == ""
	default:
		return true
	}
}

func filterCandidateIDs(ids []int, modelName string, filters []dto.ChannelFilter) []int {
	if len(ids) == 0 || len(filters) == 0 {
		return ids
	}
	kept := ids
	for _, kind := range filterEvalOrder {
		kindFilters := make([]dto.ChannelFilter, 0)
		for _, filter := range filters {
			if filter.Kind == kind {
				kindFilters = append(kindFilters, filter)
			}
		}
		if len(kindFilters) == 0 {
			continue
		}
		next := make([]int, 0, len(kept))
		for _, id := range kept {
			channel, exists := channelsIDM[id]
			if !exists && kind == dto.FilterRequestPath {
				next = append(next, id)
				continue
			}
			if !exists || channel == nil {
				continue
			}
			matches := true
			for _, filter := range kindFilters {
				if !channelMatchesFilter(channel, modelName, filter) {
					matches = false
					break
				}
			}
			if matches {
				next = append(next, id)
			}
		}
		kept = next
	}
	return kept
}

func filterAbilitiesByConstraints(abilities []Ability, modelName string, filters []dto.ChannelFilter) []Ability {
	if len(abilities) == 0 || len(filters) == 0 {
		return abilities
	}
	ids := make([]int, 0, len(abilities))
	seen := make(map[int]struct{}, len(abilities))
	for _, ability := range abilities {
		if _, exists := seen[ability.ChannelId]; !exists {
			seen[ability.ChannelId] = struct{}{}
			ids = append(ids, ability.ChannelId)
		}
	}
	var channels []*Channel
	if err := DB.Where("id IN ?", ids).Find(&channels).Error; err != nil {
		return nil
	}
	channelsByID := make(map[int]*Channel, len(channels))
	for _, channel := range channels {
		channelsByID[channel.Id] = channel
	}
	filtered := make([]Ability, 0, len(abilities))
	for _, ability := range abilities {
		if ok, _ := ChannelSatisfiesFilters(channelsByID[ability.ChannelId], modelName, filters); ok {
			filtered = append(filtered, ability)
		}
	}
	return filtered
}
