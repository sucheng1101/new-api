# Prompt Hubs Five-Model Video Plugin

`prompt-hubs` is a preloaded third-party Task Plugin for the Prompt Hubs `/v1/videos` contract. The binary carries it for local integration, while the administrator UI and plugin lifecycle continue to identify it as third-party. It is intentionally separate from the native MiniMax/Hailuo plugin and its type-35 channel. Keep an existing native Hailuo channel unchanged while this channel is introduced and accepted.

## Included models and limits

| Public model | Prompt Hubs upstream `model` | Seconds | Resolution rows shown in Model Pricing |
| --- | --- | --- |
| `MiniMax-H3` | `minimax_h3` | Integer `4` through `15` | `768`, `1080p`, `2K`, `4K` |
| `minimax_h3` | `minimax_h3` | Integer `4` through `15` | `768`, `1080p`, `2K`, `4K` |
| `MiniMax-H3-漫剧优化` | `MiniMax-H3-漫剧优化` | Integer `4` through `15` | `768`, `2K`, `4K` |
| `MiniMax-H3-量化版` | `MiniMax-H3-量化版` | Integer `4` through `10` | `768` |
| `MiniMax-H3-四步采样版` | `MiniMax-H3-四步采样版` | Integer `4` through `15` | `768`, `1080p` |

Supported aspect ratios are `21:9`, `16:9`, `4:3`, `1:1`, `3:4`, and `9:16`. `minimax_h3` requires at least one reference-media URL for `2K` and `4K` requests.

Reference media must be publicly reachable HTTP(S) URLs. The plugin accepts up to nine images, three videos, three audio files, and twelve total media items. It does not upload local files to Prompt Hubs.

## Build and enable

1. Rebuild and restart this NewAPI fork. `plugins/tasks/prompt-hubs/plugin.js` is embedded into the binary at build time.
2. Sign in as an administrator and open **Operation Settings -> Sidebar Management**. Enable the **Task Plugins** module when it is hidden.
3. Open **Task Plugins** and confirm that the built-in **Prompt Hubs Video** plugin with key `prompt-hubs` is enabled.
4. Create a new channel with type **Task Plugin (61)**.
5. Select **Prompt Hubs Video**. The channel setting must contain `task_plugin_key = prompt-hubs`.
6. Set Base URL to `https://console.prompt-hubs.com`, then enter the Prompt Hubs upstream key in the channel key field.
7. Add these five exact public models as channel models, comma-separated. No channel model mapping is required for the public `MiniMax-H3` entry: the plugin preserves it as the billing identity and sends `minimax_h3` upstream.

   ```text
   MiniMax-H3,minimax_h3,MiniMax-H3-漫剧优化,MiniMax-H3-量化版,MiniMax-H3-四步采样版
   ```

8. Enable the channel and save it. The new type-61 channel owns the Prompt Hubs protocol; do not change the type-35 Hailuo channel to point at the Prompt Hubs host.

An optional public alias can map to one of the five declared models. The alias retains its own public Model Pricing entry; the selected channel and plugin decide the upstream spelling and validation profile.

## Pricing setup

1. Open **Model Pricing** and select the public model clients call. For shared `MiniMax-H3`, configure one **Base Price** expression using only `seconds` and `resolution`.
2. This base expression is used by both eligible paths: native type-35 Hailuo and type-61 Prompt Hubs. It is evaluated once after the selected channel has supplied its own validated facts.
3. Open the **Hailuo Video** plugin tab only when Hailuo reference media needs an additional charge. Its addon expression may use `input_images` and `input_video_seconds`; it is added only for a request that selected the Hailuo channel.
4. The **Prompt Hubs Video** plugin tab has no addon fields. Requests through Prompt Hubs use the Base Price only.

The shared billing facts are exactly `seconds` and `resolution`. A request charges the configured coefficient for its selected resolution multiplied by the requested seconds. The Hailuo-specific reference-media addon is separately frozen at submission and recomputed from final task usage when available. Plugin source contains no vendor price values.

## Request format

Use NewAPI's OpenAI-compatible video endpoint. This example uses a placeholder relay token and does not include an upstream key:

```bash
curl -sS http://127.0.0.1:5200/v1/videos \
  -H 'Authorization: Bearer RELAY_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "MiniMax-H3",
    "prompt": "A paper boat drifts along a quiet river at dawn.",
    "seconds": 5,
    "size": "1080p",
    "aspect_ratio": "16:9"
  }'
```

For a `2K` or `4K` `MiniMax-H3` request, provide at least one public reference URL:

```json
{
  "model": "MiniMax-H3",
  "prompt": "A cinematic city street after rain.",
  "seconds": 5,
  "size": "2K",
  "aspect_ratio": "16:9",
  "reference_images": ["https://cdn.example/reference.jpg"]
}
```

The plugin sends the following upstream body shape:

```json
{
  "model": "minimax_h3",
  "prompt": "...",
  "duration_seconds": 5,
  "resolution": "1080p",
  "aspect_ratio": "16:9"
}
```

Creation uses `POST /v1/videos`; polling uses `GET /v1/videos/{task_id}`. Completed videos are served through NewAPI task artifact URLs. The Responses API renders the NewAPI artifact URL and never returns the upstream signed media URL.

## Acceptance checks

Before enabling the channel for users, run one valid request for every model and verify the matching `seconds x resolution` Base Price row is charged. For Hailuo reference-media requests, also verify the addon facts and final reconciliation. NewAPI rejects these cases before it submits an upstream task:

- `MiniMax-H3` or `minimax_h3`: `3` seconds, an unsupported resolution, or `2K`/`4K` without a reference URL.
- `MiniMax-H3-量化版`: `11` seconds or a resolution other than `768`.
- `MiniMax-H3-四步采样版`: `4K`.

For rollback, disable only the type-61 Prompt Hubs channel. The existing native Hailuo channel remains intact.
