# Jellyfin Client

_v1.0.5_

What to verify on Switch

 1. Direct play: an H.264/AAC mp4 or mkv plays via
2. Transcode: a too-big source comes back as an HLS TranscodingUrl and plays
3. Seek +30s on files (known good) and on HLS transcodes (server restarts the stream at the new offset — verify)
4. Resume: stop mid-file, item appears in Continue watching with position
5. Audio universal endpoint plays music
6. Bitrate test returns a sane LAN number

 Verification notes

 Endpoint paths, methods, auth header format and field names checked against @jellyfin/sdk 0.13.0 (Jellyfin 10.11 OpenAPI). Targets Jellyfin \>= 10.9.

 Known open questions

 - Brewser manifest allowed\_origins vs user-typed LAN addresses — needs a wildcard or runtime permission story before the real app ships
- HEVC software decode budget: the Brewser direct-play list is optimistic on purpose; measure with the harness and trim so heavy sources transcode

---

- **Developer:** natureglass
- **Brewser profile:** [natureglass](https://brewser.io/profile?publisher=natureglass)
- **License:** [MIT](https://choosealicense.com/licenses/mit)
- **Website:** [https://github.com/natureglass](https://github.com/natureglass)
