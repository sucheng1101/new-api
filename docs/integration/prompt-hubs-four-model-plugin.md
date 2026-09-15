# Prompt Hubs Four-Model Video Plugin

`prompt-hubs` is a built-in Task Plugin for the Prompt Hubs `/v1/videos` contract. It is intentionally separate from the native MiniMax/Hailuo plugin and its type-35 channel. Keep an existing native Hailuo channel unchanged while this channel is introduced and accepted.

## Included models and limits

| Model | Seconds | Resolution rows shown in Model Pricing |
| --- | --- | --- |
| `minimax_h3` | Integer `4` through `15` | `768`, `1080p`, `2K`, `4K` |
| `MiniMax-H3-漫剧优化` | Integer `4` through `15` | `768`, `2K`, `4K` |
| `MiniMax-H3-量化版` | Integer `4` through `10` | `768` |
| `MiniMax-H3-四步采样版` | Integer `4` through `15` | `768`, `1080p` |

Supported aspect ratios are `21:9`, `16:9`, `4:3`, `1:1`, `3:4`, and `9:16`. `minimax_h3` requires at least one reference-media URL for `2K` and `4K` requests.

Reference media must be publicly reachable HTTP(S) URLs. The plugin accepts up to nine images, three videos, three audio files, and twelve total media items. It does not upload local files to Prompt Hubs.

## Build and enable

1. Rebuild and restart this NewAPI fork. `plugins/tasks/prompt-hubs/plugin.js` is embedded into the binary at build time.
2. Sign in as an administrator and open **Operation Settings -> Sidebar Management**. Enable the **Task Plugins** module when it is hidden.
3. Open **Task Plugins** and confirm that the built-in **Prompt Hubs Video** plugin with key `prompt-hubs` is enabled.
4. Create a new channel with type **Task Plugin (61)**.
5. Select **Prompt Hubs Video**. The channel setting must contain `task_plugin_key = prompt-hubs`.
6. Set Base URL to `https://console.prompt-hubs.com`, then enter the Prompt Hubs upstream key in the channel key field.
7. Add these four exact models as channel models, comma-separated, with no model mapping:

   ```text
   minimax_h3,MiniMax-H3-漫剧优化,MiniMax-H3-量化版,MiniMax-H3-四步采样版
   ```

8. Enable the channel and save it. The new type-61 channel owns the Prompt Hubs protocol; do not change the type-35 Hailuo channel to point at the Prompt Hubs host.

An optional public alias can map to one of the four exact upstream IDs. The plugin sends the mapped upstream model to Prompt Hubs and uses that upstream model's usage profile for validation and billing.

## Pricing setup

1. Open **Model Pricing** and select one of the four model names.
2. Choose the **Prompt Hubs Video** plugin variant, then open its task-pricing matrix.
3. Enter the approved per-second coefficient for every visible resolution row and save.

The billing facts are exactly `seconds` and `resolution`. A request charges the configured coefficient for its selected resolution multiplied by the requested seconds. The plugin does not contain vendor price values and does not fall back to the native Hailuo price matrix.

## Request format

Use NewAPI's OpenAI-compatible video endpoint. This example uses a placeholder relay token and does not include an upstream key:

```bash
curl -sS http://127.0.0.1:5200/v1/videos \
  -H 'Authorization: Bearer RELAY_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "minimax_h3",
    "prompt": "A paper boat drifts along a quiet river at dawn.",
    "seconds": 5,
    "size": "1080p",
    "aspect_ratio": "16:9"
  }'
```

For a `2K` or `4K` `minimax_h3` request, provide at least one public reference URL:

```json
{
  "model": "minimax_h3",
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

Before enabling the channel for users, run one valid request for every model and verify the matching `seconds x resolution` row is charged. Also verify that NewAPI rejects these cases before it submits an upstream task:

- `minimax_h3`: `3` seconds, an unsupported resolution, or `2K`/`4K` without a reference URL.
- `MiniMax-H3-量化版`: `11` seconds or a resolution other than `768`.
- `MiniMax-H3-四步采样版`: `4K`.

For rollback, disable only the type-61 Prompt Hubs channel. The existing native Hailuo channel remains intact.
