# Voice-01 审查与技术方案

> 后续变更：用户要求使用 `Car-Assistant` 的腾讯云识别方案替换本地 ASR。当前实现使用腾讯云一句话识别（16 kHz PCM），浏览器录音在服务端由 ffmpeg 转换；音频发送腾讯云，可能产生费用。以下本地 ASR 文字为原方案记录。

## 基线与参考项目

- 导航基线：main `0c6734f`，已包含珠海地图提交 `7e8643a`；GPS 分支不是 main 的祖先。
- 参考仓库：本机 `PolyU_dissertation/ar_hud_prototype`，remote 为 `LazyZ14/lunwen`，HEAD `f81eb15`。
- `voice-assistant/asr.py` 直接通过 PyAudio 采集服务端麦克风，阿里云实时 ASR 或腾讯云一句话 ASR 要求凭证与网络。腾讯的 `recognize_audio` 有音频字节入口，但要求 16 kHz PCM；浏览器录音需要额外转码及云服务授权。不能直接复用作为本地 ASR。
- `backend/voice_bridge.py` 以线程、静默计时和 pywebview 回调连接 ASR 与 HUD；`backend/web_panel.py` 将 final 文本送入 `/hud/dispatch`。该流程与服务端麦克风、桌面壳和旧 HUD 耦合，只借鉴状态与文本传递方式。
- `backend/app.py` 的 `analyze_intent` 使用 Ollama `qwen2.5:7b`、JSON 模式及低温 prompt，但输出针对旧推荐逻辑，校验不足；适配思路，重新定义严格的导航 Schema，禁止坐标和任意动作。
- `voice-assistant/tts.py`、`main.py`、`wake_word_sherpa.py` 分别实现云 TTS、连续对话和唤醒词；不纳入本阶段。唤醒词模型不是通用 ASR 模型。`voice-assistant/requirements.txt` 依赖 PyAudio、云 SDK 等；无需整体引入。仓库未发现项目根许可证，故不直接复制源码；第三方模型及 SDK 需分别核对许可。
- 本机 Ollama 已安装 `qwen2.5:7b`。用户授权后安装 Faster-Whisper 1.2.1 并下载 `Systran/faster-whisper-small`（约 464 MiB），使用 CPU int8；模型保存在 Git 忽略的 `data/models/`。PyAV 限定低于 19，因 19 移除了 Faster-Whisper 使用的音频解码参数。无需收费 API。

## 最小设计

浏览器按键录音，将音频上传 FastAPI 的 Faster-Whisper 适配器；文本回退走同一意图接口。LLM 使用 Ollama 本地 HTTP 接口，模型输出只允许导航意图、目的地文字、澄清标记；服务端严格验证，出错安全返回，不执行任意指令或接受模型坐标。

本地 OSM 导出的 POI 和地点数据是坐标唯一来源。已有 POI 导出未包含 `amenity=parking`，需扩展构建脚本并重建数据；没有候选明确告知，不虚构 POI。候选展示在 MapLibre 上，用户确认后用现有导航会话接口规划路线；取消不创建会话。查询仅提供明确名称和少数类别的基础匹配，不声称语义推荐。

错误分离麦克风权限、录音、空语音、ASR 不可用/失败、LLM 不可用/非法输出、无候选及不可达路线。现有路线和回放接口不变。测试使用合成音频及 fake 模型/路由服务；真实链路需本地 ASR 服务、模型、珠海 OSRM 数据和浏览器麦克风。

## 已知运行阻塞

当前导航主工作区仅有北京 OSRM 产物；独立 worktree 已使用珠海 OSM 重新生成 OSRM 和地图数据，未修改主工作区。模型及生成文件不会随 Git 分发，其他环境需自行准备。不能将合成语音测试描述为真人语音验收。
