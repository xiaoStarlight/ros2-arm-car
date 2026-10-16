# ESP32-S3 固件源码检查与 Linux 构建交接

整理日期：2026-10-07。本次仅在 Windows 克隆、阅读和修改源码，进行网页脚本检查；未运行 ESP-IDF、CMake、编译器或烧录命令，也未连接小车、读取 COM4。

## 源码来源与版本区别

用户提供的旧仓库地址已重定向到：

```text
https://github.com/czu963889306-dev/leap_ros_pro_mcu_driver.git
```

本地目录保留用户提供的名称 `leap_ros_four_mcu_driver`。已递归克隆；当前仓库没有 `.gitmodules` 或 Git 子模块，micro-ROS 组件直接随源码提供。首次 Linux 构建仍会下载 micro-ROS Humble 的依赖。

| 来源 | 提交 | 日期 | 无有效 NVS 配置时的协议 | 代码中的通信 UART 波特率 |
| --- | --- | --- | --- | --- |
| 默认 `main` | `031df4c` | 2026-09-10 | UDP | 460800 |
| 公开发布标签 `leap_ros_prov1.1` | `6c7eda1` | 2026-09-16 | UDP | 921600 |
| 较新的 `origin/v1.1` | `d2690b3` | 2026-10-04 | UART | 921600 |

发布标签的 `doc/protocols.md` 仍写 460800，但该标签的 `main/config/network_config.h` 已是 921600，文档与代码不一致。协议参数以对应版本代码和设备实际配置为准。

本次修改基于 `origin/v1.1`，完整基准提交：

```text
d2690b35fc0dff95fa65f48dd2820bc2d29cc4c8
```

本地开发分支 `local/communication-review`。它比公开 Release 更新，包含作者的手柄控制调整；并未验证这些上游功能在当前小车上的表现。源码已提供 `version.txt`，本地构建标识为 `v1.1-d2690b3-local`，不将它冒充作者正式发布版本。

公开 Release：<https://github.com/czu963889306-dev/leap_ros_pro_mcu_driver/releases/tag/leap_ros_prov1.1>。该页的 `leap_ros_pro_v1.bin` 文件名不能证明板上固件版本，发布二进制也未在本次下载或解析。

## 代码检查结论

1. 主控此前实测 Agent 是 UART `/dev/ttyAML0`、921600。最新 `v1.1` 源码的 UART 参数与它一致。
2. 协议保存在 ESP NVS 的 `runtime_cfg/comm_mode`；有效旧值优先于新默认值。正常更新应用镜像后，如果仍保留 NVS，原先保存的 UDP 选择也会保留。
3. 运行值 `micro_ros` 表示 UDP，`microros_uart` 表示 UART。实际板上选择尚未读取，不能从源码默认值推断它。
4. 协议选择界面在 ESP HTTP 服务中，端口 80，页面为 `main/tasks/network/provision/provision_portal_page.h`，后端为同目录的 `provision_portal.cpp`。`GET /api/status` 返回 `runtime.comm_mode`；`POST /api/runtime-config` 保存设置并重启。
5. ESP STA 联网成功时，通过 ESP 自己的 DHCP 地址访问。STA 联网失败时进入 `Maturo_<MAC>` 配网热点，连接后访问 `http://192.168.4.1`。S905 主控 IP 与 ESP IP 是两个地址。
6. UART 使用 UART2、GPIO37 TX、GPIO38 RX、8N1、无硬件流控，收到 `MATURO_MICROROS_START` 才开始 micro-ROS。ESP 发布 `/wifi_config`，并接收主控 `/host_info` 作为心跳。UART 通信与 UART0 的 230400 调试输出分开。
7. UDP 使用保存的 Agent IPv4/端口，默认 `192.168.31.214:8888`。仅当选择 UDP 时这些参数参与数据传输；如需 UDP，主控也须运行对应 UDP Agent，ESP 网络能访问该地址。

以上是源码行为。尚未确认板上版本、保存协议、端子信号或新固件通信结果，因此未给出已确诊的硬件故障原因。

## 本次修改

- 新增 `CONFIG_MICRO_ROS_UART_BAUDRATE`，在 `idf.py menuconfig` 的 `Leap low settings` 中配置，默认与随附 `sdkconfig`/`sdkconfig.defaults` 均为 921600。UART 驱动与网页状态读取同一个配置；其他主控需改为匹配波特率。
- 修复 BOOT 短按切换：原代码只修改运行标志，已建立的 ROS 会话没有随标志变化重建；UDP 未联网时还可能没有通信任务。现在保存成功后延迟重启，由启动路径按保存协议创建任务。保存失败则保持当前模式。
- 网页保存运行设置也统一在重启后应用，避免重启前出现新配置标志配旧传输会话的情况。
- 网页将 UDP 明确标为 `micro-ROS UDP`，显示运行协议、UART 波特率、固件版本与构建时间。UART 模式的状态摘要显示波特率，不把 UDP Agent 地址当作 UART 地址。
- `/api/status` 增加 `runtime.microros_uart_baudrate` 与 `firmware` 对象，后者包含版本、IDF 版本、构建日期/时间、完整 ELF SHA256。元数据来自 ESP-IDF 的应用描述。

新状态字段只有构建并安装本地修改后的固件才会出现。旧固件通常已有 `runtime.comm_mode`，但不能假设它已有固件版本或波特率字段。显示当前协议不等于 micro-ROS 已连接。

## 将源码带到 Linux

优先复制本次提供的 `esp32-v1.1-review-source.tar.gz` 和同目录 `ESP_FIRMWARE_REVIEW.md` 到 Linux。源码包包含修改及 `managed_components`、`components`、`extra_ros_packages`，未包含 `.git` 或编译产物；Linux 构建脚本使用 LF 换行。

```bash
tar -xzf esp32-v1.1-review-source.tar.gz
cd leap_ros_four_mcu_driver
```

也可直接传整个本地 Git 目录，保留未提交修改，但需确保 make 文件使用 LF 换行。仅重新克隆上游或切换分支会缺少本次本地修改。

## Linux 构建步骤（交由用户执行）

`dependencies.lock` 记录作者使用 ESP-IDF 5.5.3；组件要求 IDF >=5.3.0。建议先使用 5.5.3，目标为 ESP32-S3。若 Linux 未安装 ESP-IDF，可按以下步骤安装到自己的开发目录：

```bash
sudo apt-get update
sudo apt-get install -y git wget cmake ninja-build build-essential ccache \
  python3 python3-pip python3-venv dfu-util libusb-1.0-0
mkdir -p "$HOME/esp"
git clone --recursive --branch v5.5.3 https://github.com/espressif/esp-idf.git "$HOME/esp/esp-idf"
"$HOME/esp/esp-idf/install.sh" esp32s3
```

打开未加载 ROS 2 环境的新终端，进入解压后的工程目录。不要在 Windows 执行以下构建命令：

```bash
source "$HOME/esp/esp-idf/export.sh"
python -m pip install catkin_pkg colcon-common-extensions lark 'empy<4'

# dependencies.lock 带有作者电脑的绝对路径，迁移后让组件管理器重新生成。
# 随附 managed_components 保留已下载组件；新锁文件应记录当前机器路径。
mv dependencies.lock dependencies.lock.author

idf.py set-target esp32s3
idf.py menuconfig
idf.py build
```

`set-target` 会重新生成配置，随附 `sdkconfig.defaults` 已保留基本板型、分区、日志 UART 与 921600 通信 UART 设置。进入 `menuconfig` 时确认 `Leap low settings -> micro-ROS UART baud rate` 是 921600；其余板型、Flash 和分区需与实物匹配。当前源码默认 Flash 为 4 MB，分区使用 `partitions.csv`，未依据未知板型改变这些值。

本工程的 micro-ROS 组件在 CMake 配置阶段就执行 make，因此 `set-target`、`menuconfig` 也可能触发依赖构建和网络下载。构建机需要访问 GitHub、GitLab 及 ESP 组件源。

成功后应用镜像通常是 `build/leap_ros_four.bin`，其他镜像、偏移和烧录参数由 `build/flasher_args.json` 描述。此次只交付源码，不包含烧录指令；构建成功后应依据实际板型与作者步骤确认安装方式，不推断 Release 中 `.bin` 是应用镜像还是合并镜像。

## 安装后的通信核对

通过 ESP 网页查看运行设置，保留实际底盘类型。如果主控继续使用此前 UART Agent，就选择 `micro-ROS UART` 并保存重启；确认状态接口的 `runtime.comm_mode` 是 `microros_uart`、`runtime.microros_uart_baudrate` 是 921600。固件标识应为 `v1.1-d2690b3-local`。

主控的 WiFi 话题覆盖配置保持 `/wifi_config_manual_only`；UART 心跳监听仍是 `/wifi_config`，IP/主机心跳仍是 `/host_info`。网络配置节点改订阅不会移除 ESP 的通信心跳发布逻辑。

通信建立后应看到 `/leap_ros_pro` 节点，`/wifi_config` 有 ESP 发布者，并出现 `/set_arm_pose` 等服务。先验证在线信息，不用运动指令来判断连接。

## 已做检查与限制

- 已阅读分支、标签及提交差异，核对配置加载、NVS、网页 API、UART 启动与 ROS 会话路径。
- 已核对 ESP-IDF 5.5.3 的 `esp_app_desc.h` API，增加对应 `esp_app_format` 依赖。
- 网页脚本解析及模拟状态显示检查通过：UART、UDP、未知状态、固件信息、中英文字段、状态轮询保留未保存选择。
- 已进行 Git 差异格式检查及 Linux 交付文件换行检查。
- 未编译 C/C++、未验证链接、Flash 占用、实际按钮重启或硬件数据；这些需要 Linux 构建及实机验证。暂不能保证构建成功或通信故障已解决。
