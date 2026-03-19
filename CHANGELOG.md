# Changelog

## [1.0.0] - 2026-03-19

### Added
- Initial release
- Profile list view with detail panel (base URL, model, masked API key, connectivity status)
- One-key profile switching via symlink
- Init wizard for first-time users with existing `settings.json`
- Create, edit, rename, and delete profiles
- Quick model update form
- Connectivity test (GET `/v1/models`, 5-second timeout, no token consumed)
- Export profile to Desktop with masked API key
- Import profile from pasted JSON with masked-key detection
- Auto backup to `~/.claude/backups/` before delete/edit (max 10 backups)
- Provider templates: Custom / Anthropic Official / LongCat
- First-time security notice for API key storage
