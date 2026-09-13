# NVR - The Watcher

_v1.0.0_

The "Fill in a common address" dropdown has these ready to edit.

 `Hikvision rtsp://user:pass@IP:554/Streaming/Channels/101 (102 = sub stream) Dahua/Amcrest rtsp://user:pass@IP:554/cam/realmonitor?channel=1&subtype=0 Reolink rtsp://user:pass@IP:554/h264Preview_01_main Axis rtsp://user:pass@IP/axis-media/media.amp http://IP/axis-cgi/mjpg/video.cgi http://IP/axis-cgi/jpg/image.cgi ESP32-CAM http://IP:81/stream http://IP/capture Foscam http://IP:88/cgi-bin/CGIStream.cgi?cmd=GetMJStream&usr=U&pwd=P go2rtc http://127.0.0.1:1984/api/webrtc?src=camera1 (WHEP) MediaMTX http://127.0.0.1:8889/NAME/whep (WHEP) http://127.0.0.1:8888/NAME/index.m3u8 (HLS)`

 Kind is auto-detected from the URL, then confirmed by a content-type probe. If a URL turns out to be a web page rather than a stream you get told so; pick the stream URL from the camera's own page instead.

 Relay details `PORT=8080 HOST=127.0.0.1 FFMPEG_PATH=ffmpeg MAX_RELAYS=8 node server.js`

 Endpoints:

 - `GET /api/health` relay and ffmpeg status
- `GET /api/rtsp?url=rtsp://...&fps=15&width=1280&quality=6&transport=tcp` multipart MJPEG
- `GET /api/rtsp/stats?url=...` encoder state, fps, frames, bytes, restarts, last stderr
- `GET /api/streams` running relays
- `GET /api/proxy?url=http://user:pass@cam/...` HTTP fetch with Basic/Digest auth and CORS

 One ffmpeg process per RTSP URL, shared between viewers. Slow viewers skip frames rather than stall the encoder. A stream restarts with backoff if ffmpeg dies or stops producing frames for 20 s, and shuts down 5 s after the last viewer leaves.

 Security: the proxy will fetch any http(s) URL it is given, so keep `HOST` on `127.0.0.1` unless you put the relay behind something that authenticates. It never logs credentials; they are stripped from URLs before logging.

 Troubleshooting

 - "Relay not found": start `node server.js`, or set the address in the popover. If `index.html` is served from `https://`, the relay must be reachable over https too, or the browser will block it (mixed content).
- RTSP shows "Relay encoder: error": read "ffmpeg says" in the stats. 401 means wrong credentials, 404 usually means the wrong path for that camera model. Switch RTSP transport to UDP in Options if the camera does not support TCP interleaving.
- H.265/HEVC cameras play fine over RTSP (ffmpeg decodes them) but not over HLS or WebRTC in most browsers; use the RTSP path or a sub stream set to H.264.
- HLS in standalone mode needs internet access to load hls.js; three CDNs are tried in turn.
- MJPEG on an old camera shows one frame then stops: some cameras send concatenated JPEGs with no multipart boundary. The Watcher

---

- **Brewser profile:** [natureglass](https://brewser.io/profile?publisher=natureglass)
- **License:** [MIT](https://choosealicense.com/licenses/mit)
- **Website:** [https://github.com/natureglass](https://github.com/natureglass)
