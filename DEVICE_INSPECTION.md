# S905L3A 实机检查与 WiFi 同步调整

首次检查日期：2026-10-06。当时用户断开 ESP32-S3 与 S905L3A 之间的端子线，并手动连接主控 WiFi。用户随后已接回端子线并重启；后续结果及 2026-10-07 暂停状态记录如下。

最新状态：2026-10-07 用户更新 ESP 固件后，实测作者原有网页 Demo 各项功能可正常使用，开始二次开发。此前“通信尚未恢复”均为历史检查结果。本次已完成并部署主控网页舵机角度限制，详情见 [WEB_ARM_LIMITS.md](WEB_ARM_LIMITS.md)。

2026-10-08 网页追加修改已部署：夹爪恢复 0–180° 连续滑块，各通道独立记住本页上次成功发送的目标角度；未发送或发送失败不覆盖记录，回正命令也逐通道更新。Windows/主控 8 项测试、网页构建及完整 App 浏览器模拟检查通过。记录不代表实测位置，刷新页面后重置。

2026-10-09 最新修改已部署：夹爪范围按最新实测收紧为 **120–180°**，参考值 120°；新增五色红框识别及机械臂小步居中。用户确认摄像头在夹爪上方，实际 WebRTC 视频读取成功（2304×1296）。最终本地/主控 15 项测试和网页构建通过，完整 App 合成画面跟随测试通过；尚未执行实物方块闭环跟随。详见 [COLOR_FOLLOWING.md](COLOR_FOLLOWING.md)。

2026-10-09 用户首轮实物反馈：颜色识别正常，通道 4 方向正常，通道 1 方向异常；确认通道 1 增角向左、通道 4 增角向下。已部署固定实物方向及每步 5° 的修复，限位处截断，近中心保留较近位置防摆动。最终本地/主控 19 项测试、构建及浏览器模拟检查通过；本次未由 AI 发送实物运动命令。备份为 `/root/ros2_web/.follow-direction-5deg-backup-2026-10-09T13-53-26-134Z`。

2026-10-10 平滑提速版已部署：同关节同向大偏差最早 0.8 秒更新，换轴/换向/近中心至少等待 1.2 秒；保留 5°、增加 160 ms 位置低通滤波与轴优先滞回。本地/主控 23 项测试、网页构建和浏览器模拟通过；按作者 1 秒全局插值建立的模型显示同向运动停顿减少，实物体感未复测。备份为 `/root/ros2_web/.follow-smooth-backup-2026-10-10T03-56-37-474Z`。

2026-10-10 最新已部署：跟随步长 **10°**；目标未检测到时保持识别和跟随意图、暂停发令，重现后自动继续；摄像头画面丢失则关闭识别，视频恢复需手动重启。手动停止不自动恢复。本地/主控 25 项测试、构建和完整网页模拟通过，未发送实物运动命令。备份为 `/root/ros2_web/.follow-wait-10deg-backup-2026-10-10T06-09-25-833Z`。

## 已确认的系统与网络

| 项目 | 实机结果 |
| --- | --- |
| SSH | `root@192.168.252.162`，密码由用户另行提供，不记录在仓库中 |
| 主机名 | `chuyunpi` |
| 操作系统 | Armbian OS 23.8.1，Ubuntu 22.04.3 LTS / Jammy |
| 内核 | `6.12.98-ophub` |
| 架构 | `aarch64` / Debian `arm64` |
| 无线网卡 | Realtek RTL8188EUS，USB ID `0bda:8179` |
| 无线接口 | `wlan0` |
| 当前热点 | `HONOR_90` |
| 当前 IPv4 | `192.168.252.162/24`，通过 DHCP 获取 |
| 默认网关 | `192.168.252.113` |
| 网络验证 | 新建 SSH 会话成功；DNS 解析成功；外部 IP 连通性测试成功 |
| 网络配置 | 当前热点的 NetworkManager 配置已启用自动连接 |

当前网卡驱动及基本网络功能正常。重启后 DHCP 地址可能变化，应以热点设备列表或主控 `ip -br address` 为准。

## ESP WiFi 同步逻辑

主控开机自启 `wifi-config-applier.service`，启动 ROS 2 节点 `/wifi_config_applier`。源码位置：

```text
/root/chuyun_ws/src/xuegecar_wifi_config/xuegecar_wifi_config/wifi_config_applier.py
```

原行为：

1. 订阅 `/wifi_config`，解析 ESP 发送的 SSID 和密码。
2. 如果存在同名 WiFi 配置，先删除该配置。
3. 执行 `nmcli device wifi connect ... ifname wlan0`，尝试连接 ESP 指定的热点。
4. 仅在成功后记录已应用配置；失败后，后续相同消息仍会触发连接尝试。

该逻辑能够干预主控手动配置的网络，与用户观察到“断开端子线后可正常联网”的现象相符。本次检查时 ESP 已断开，未捕获当时 ESP 实际发送的配置，也未复现此前的失败。

另一个节点 `/maturo_microros_uart_starter` 也订阅 `/wifi_config`，但它仅将收到的消息作为在线心跳，不修改网络；心跳消失时向串口发送启动口令。因此，应保留这个节点对原话题的订阅。

## 已部署的调整

通过 systemd drop-in 指定 WiFi 配置节点的输入话题，让其改为监听 `/wifi_config_manual_only`，不再处理 ESP 发布在 `/wifi_config` 上的网络配置。该专用话题保留手动发布配置的能力，平时无需向它发布任何内容。

主控上新增的文件：

```text
/etc/systemd/system/wifi-config-applier.service.d/90-manual-host-wifi.conf
```

仓库中保存了同一配置：[90-manual-host-wifi.conf](device_config/wifi-config-applier/90-manual-host-wifi.conf)。

部署后已执行 `systemctl daemon-reload` 和 `systemctl restart wifi-config-applier.service`。服务仍为开机自启；首次部署时未重启整台主控，后续用户已重启，确认覆盖配置继续生效。

## 已完成的验证

- 节点参数 `topic` 为 `/wifi_config_manual_only`。
- `/wifi_config` 的订阅者由两个减少为一个，剩余节点是 UART 心跳监测节点。
- `/wifi_config_manual_only` 的订阅者是 WiFi 配置节点，目前没有发布者。
- `/host_info` 仍正常发布，实际收到 `hostname=chuyunpi ip=192.168.252.162`。
- `wifi-config-applier.service`、`micro-ros-agent.service`、`xuegecar-bringup.service` 均为 `active`。
- 调整后重新建立 SSH 会话成功，WiFi 和外部网络测试正常。

首次验证覆盖主控侧配置和服务运行情况。后续接回 ESP 并重启后，主控仍可联网，WiFi 节点参数继续生效；ESP 通信及机械臂控制尚未恢复。

## 接线与重启后的通信检查

以下为此前检查结果，本次整理记录没有重新连接设备：

- 主控仍可通过 `192.168.252.162` SSH 访问，`wlan0` 仍连接 `HONOR_90`。另有 `usb0` 地址 `172.32.0.100/24`，用途尚未确认。
- `/wifi_config_applier` 的 `topic` 参数仍为 `/wifi_config_manual_only`，证明 WiFi 覆盖配置在重启后持续生效。
- `micro-ros-agent.service` 为 `active`，启动 `/usr/local/sbin/maturo-microros-agent-start`。实际 Agent 使用 UART `/dev/ttyAML0`、波特率 `921600`；此前检查未发现运行 UDP 模式的 Agent。
- Agent 日志持续出现 `sent UART start command; waiting for fresh heartbeat`，尚无 ESP 新鲜心跳或会话建立的证据。
- 后续 `ros2 topic info /wifi_config -v --no-daemon` 返回 `Unknown topic '/wifi_config'`。当前未取得 ESP 心跳发布者信息，不能仅凭服务为 `active` 判断设备通信正常。
- ESP 当前通信模式、UART 波特率、固件版本，以及选择 UDP 时的 Agent 地址和端口均待确认。主控 UART 参数不能代表 ESP 已选择相同协议。

## 作者推荐的上位机配置检查进展

用户要求先检查上位机网络配置中的 UDP/UART 选项，暂不查看 COM4；最新重启未使用串口。

- 厂家网页目录 `/root/ros2_web` 已找到，包含 `README.md`、`server.js`、`ros_config.json`、`src/`、`dist/`、`start_console.sh`、`start_console.log`、`vite.config.js` 等。
- 第一轮源文件关键词扫描只匹配到 `/root/ros2_web/src/composables/useFoxglove.js` 的 Foxglove WebSocket 协议说明，尚未找到 UDP/UART 设置入口。扫描排除了 `dist` 和 `node_modules`，结论不能扩展为“页面不存在通信设置”。
- 最新本地手册 `leap_ros_pro 开源产品手册_2.pdf` 已打开，尚未提取网络配置操作步骤。需确定作者所指入口属于主控网页、ESP 网页还是其他程序，并读取其实际选择及保存逻辑。
- 上位机页面当前选择的协议尚未确认，ESP 固件是否最新也尚未确认。

## 暂停与恢复安排（2026-10-07）

用户要求暂停工作，稍后自行检查 ESP 固件版本。本次仅整理文档，未继续连接主控、读取 COM4、修改设备配置或烧录固件。

恢复后先结合用户提供的 ESP 版本信息，继续检查作者推荐的网络配置页面，核对 ESP 与主控的协议及参数。确认不匹配后再决定必要调整；目前不将固件过旧、波特率差异或接线问题当作已确诊原因。通信恢复后再验证 ESP 心跳、ROS 节点和机械臂接口。

## 后续离线固件源码检查（2026-10-07）

用户随后要求克隆作者 ESP 固件仓库并查看代码，允许有依据的源码修改，明确不在 Windows 编译。已完成离线检查和修改，未重新连接设备。详细交付与 Linux 构建步骤见 [ESP_FIRMWARE_REVIEW.md](ESP_FIRMWARE_REVIEW.md) 和 [LINUX_BUILD_HANDOFF.md](leap_ros_four_mcu_driver/doc/LINUX_BUILD_HANDOFF.md)。

- 默认 `main` 为 UDP/460800；公开标签 `leap_ros_prov1.1` 的实际代码为 UDP/921600；更新的 10 月 4 日 `v1.1` 分支默认 UART/921600，和此前主控参数一致。标签协议文档里的 460800 未同步，不能据此判定代码参数。
- 源码确认网络配置页面位于 ESP 的 HTTP 服务，端口 80。STA 模式访问 ESP 自己的地址，配网热点模式访问 `192.168.4.1`；`GET /api/status` 返回 `runtime.comm_mode`，用于读取板上实际协议选择。
- 运行协议保存在 ESP NVS；有效旧配置优先于新固件默认值，因此升级应用后仍需核对协议。
- 本地改动基于 `d2690b3`：可配置 UART 波特率（默认 921600）、协议切换保存后重启生效、网页/API 增加协议及固件构建信息。
- 本地源码包为 `esp32-v1.1-review-source.tar.gz`，本地构建版本标识 `v1.1-d2690b3-local`。网页脚本和差异格式检查已做，Linux 构建与硬件验证未做。

这些是源码分析结果，板上固件版本和实际保存模式仍未知，通信恢复尚未证实。

## ROS 2 开发环境

| 项目 | 实机结果 |
| --- | --- |
| ROS 2 | Humble，安装于 `/opt/ros/humble` |
| 厂家工作空间 | `/root/chuyun_ws`，包含 `src`、`build`、`install`、`log` |
| Python | 3.10.12 |
| 构建工具 | `/usr/bin/colcon` |
| 现有包 | `leap_interfaces`、`micro_ros_agent`、`xuegecar_bringup`、`xuegecar_wifi_config`、`xuegecar_camera` 和导航相关包等 |
| micro-ROS UART | 实际运行于 `/dev/ttyAML0`，波特率 `921600` |
| 内存 | 约 1.9 GiB，检查时可用约 1.4 GiB |
| 根分区 | 约 14 GiB，检查时剩余约 7.6 GiB |

本次实机 Agent 波特率为 `921600`，与此前对话中引用的 `460800` 不同。后续以主控实际配置和 ESP 固件匹配结果为准。

登录后的非交互式 shell 不会自动保证 `ros2` 在 PATH 中，使用前加载：

```bash
source /opt/ros/humble/setup.bash
source /root/chuyun_ws/install/setup.bash
```

源码中的 `leap_interfaces/srv/SetArmPose` 定义已确认：

```text
float32 x
float32 y
float32 z
float32 pitch_deg
---
bool success
float32 x
float32 y
float32 z
float32 pitch_deg
```

接口定义存在不代表当前已经有机械臂服务提供者。ESP 断开时，未发现 `/set_arm_pose` 服务，也未发现 `/scan`、`/arm_pose`、`/servo_cmd` 和 `/cmd_vel` 话题。部分 `/imu`、`/odom` 话题由主控订阅者声明，其存在不能证明 ESP 正在发布数据。

另外，MediaMTX 的 `8554` 和 `8889` 端口处于监听状态，但未验证摄像头实际有图像输入。检查时 `5173` 端口没有监听，网页前端是否需要手动启动可在网络稳定后单独检查。

## 接回 ESP 后的检查

建议断电后重新接好端子线，再启动设备。先确认主控仍连接预期热点，并重新获取实际 IP，然后通过 SSH 检查：

```bash
nmcli device status
ip -br address

systemctl is-active wifi-config-applier.service micro-ros-agent.service xuegecar-bringup.service

source /opt/ros/humble/setup.bash
source /root/chuyun_ws/install/setup.bash
ros2 param get /wifi_config_applier topic
ros2 topic list -t --no-daemon
ros2 service list -t --no-daemon
```

进一步检查 `/wifi_config` 的发布者是否恢复，以及 `/scan`、`/arm_pose`、`/set_arm_pose` 等实际设备接口是否出现。若 ESP 未上线，下一步应检查端子连接、ESP 固件的通信模式及波特率、Agent 日志，而不能仅凭主控服务为 `active` 就认定硬件通信正常。

## 恢复原来的自动同步行为

如果以后需要恢复由 ESP 配置主控 WiFi，只移除本次新增的 drop-in，然后重启对应服务：

```bash
rm -f /etc/systemd/system/wifi-config-applier.service.d/90-manual-host-wifi.conf
systemctl daemon-reload
systemctl restart wifi-config-applier.service
```

恢复后，ESP 的网络配置会再次被主控处理，可能切换当前热点和 SSH 地址。
