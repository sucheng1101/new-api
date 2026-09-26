package dto

// MaxImageN caps the image generation count. Without this bound a huge or
// negative n could be used to spam expensive upstream requests.
// 值与官方 relaykit/dto.MaxImageN 对齐；此处落于宿主 dto 包以避免引入 relaykit。
const MaxImageN = 128
