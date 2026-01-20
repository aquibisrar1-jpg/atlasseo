# OpenCode Antigravity Auth Plugin Setup

## Installation Completed

Date: 2026-01-20

## Configuration File

Location: `~/.config/opencode/opencode.json`

## Plugin Installed

- **Plugin**: `opencode-antigravity-auth@latest`
- **Source**: https://github.com/NoeFabris/opencode-antigravity-auth

## Models Configured

### Antigravity Quota Models

1. **antigravity-gemini-3-pro** - Gemini 3 Pro with thinking variants (low, high)
2. **antigravity-gemini-3-flash** - Gemini 3 Flash with thinking variants (minimal, low, medium, high)
3. **antigravity-claude-sonnet-4-5** - Claude Sonnet 4.5
4. **antigravity-claude-sonnet-4-5-thinking** - Claude Sonnet 4.5 with thinking budgets (low: 8192, max: 32768)
5. **antigravity-claude-opus-4-5-thinking** - Claude Opus 4.5 with thinking budgets (low: 8192, max: 32768)

### Gemini CLI Quota Models

6. **gemini-2.5-flash** - Gemini 2.5 Flash
7. **gemini-2.5-pro** - Gemini 2.5 Pro
8. **gemini-3-flash-preview** - Gemini 3 Flash Preview
9. **gemini-3-pro-preview** - Gemini 3 Pro Preview

## Next Steps

### Authentication Required

After installing the OpenCode CLI, run:

```bash
opencode auth login
```

This will initiate OAuth login with Google. For multi-account setups, run the command again to add additional credentials.

### Usage Example

```bash
opencode run "Hello" --model=google/antigravity-claude-sonnet-4-5-thinking --variant=max
```

## Model Capabilities

- **Context Limits**: Up to 1,048,576 tokens (Gemini), 200,000 tokens (Claude)
- **Output Limits**: Up to 65,536 tokens (Gemini), 64,000 tokens (Claude)
- **Modalities**: All models support text, image, and PDF inputs
- **Thinking Variants**: Available on select models with configurable budgets

## References

- Plugin Repository: https://github.com/NoeFabris/opencode-antigravity-auth
- README: https://raw.githubusercontent.com/NoeFabris/opencode-antigravity-auth/dev/README.md
